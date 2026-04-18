// Birthday bonus processor — shared between the admin manual-trigger
// endpoint and the daily Vercel cron. Idempotent at the ledger layer:
// a second call for the same (tenant, member, year) is a no-op.
//
// Per qualifying member:
//   - INSERT a birthday_bonus_ledger row. Unique index on
//     (tenant_id, member_email, bonus_year) prevents double-issue.
//   - If credit_amount > 0, increment members.shop_credit_balance and
//     write a shop_credits ledger entry so the monthly reports + the
//     member account page's activity feed stay correct. Mirrors the
//     same pattern admin-loyalty.js uses for loyalty rewards.
//   - If bonus_hours > 0, increment members.bonus_hours and set
//     bonus_reconciled_month to the target month so the usage view
//     treats the new allocation as a clean slot.
//   - If the member has a Square gift card linked and credit was
//     issued, ADJUST_INCREMENT their card so Square Register reflects
//     the bonus balance on their next scan.

import { SUPABASE_URL } from "./api-helpers";
import { getSquareCredentials } from "./square-config";
import { adjustGiftCard } from "./square-api";

// Convert a YYYY-MM-DD string to a "MM-DD" key, ignoring year. Returns
// null if the input isn't a valid date string.
export function mmddFromDate(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return `${m[2]}-${m[3]}`;
}

// Compute "today" in a tenant's local timezone so a birthday on April 18
// Pacific doesn't fire at midnight UTC (i.e., the prior day locally).
// Default to America/Los_Angeles for HG.
export function targetDateForTenant(tz = "America/Los_Angeles", override) {
  if (override) return override;
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}

async function sb(key, path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
}

// Load the tenant's birthday-bonus config. Returns null if not
// configured or disabled.
async function loadConfig({ serviceKey, tenantId }) {
  const r = await sb(serviceKey, `tenant_birthday_bonus_config?tenant_id=eq.${tenantId}&select=*`);
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0] || null;
}

export async function processBirthdaysForTenant({ serviceKey, tenantId, date }) {
  const cfg = await loadConfig({ serviceKey, tenantId });
  if (!cfg || !cfg.enabled) {
    return { skipped: true, reason: "disabled", issued: 0, report: [] };
  }
  const creditAmount = Number(cfg.credit_amount || 0);
  const bonusHours = Number(cfg.bonus_hours || 0);
  if (creditAmount <= 0 && bonusHours <= 0) {
    return { skipped: true, reason: "no_reward_configured", issued: 0, report: [] };
  }

  const targetMMDD = mmddFromDate(date);
  if (!targetMMDD) {
    return { skipped: true, reason: "bad_date", issued: 0, report: [] };
  }
  const year = Number(date.slice(0, 4));
  const billingMonth = `${date.slice(0, 7)}-01T00:00:00Z`;

  // Pull all paying members with a birthday whose MM-DD matches today.
  // birthday is text (YYYY-MM-DD); PostgREST LIKE takes %25 as the
  // wildcard. Non-Member tier is excluded — birthday bonuses are a
  // membership perk.
  const pattern = encodeURIComponent(`%-${targetMMDD}`);
  const memResp = await sb(
    serviceKey,
    `members?tenant_id=eq.${tenantId}&tier=neq.Non-Member&birthday=like.${pattern}&select=email,name,shop_credit_balance,bonus_hours,square_gift_card_id,square_customer_id`
  );
  if (!memResp.ok) {
    return { skipped: false, reason: `member lookup ${memResp.status}`, issued: 0, report: [] };
  }
  const members = await memResp.json();

  let squareCreds = null;
  if (creditAmount > 0) {
    try {
      squareCreds = await getSquareCredentials(tenantId);
    } catch (_) { /* Square not configured — skip gift-card mirroring */ }
  }

  const report = [];
  let issued = 0;

  for (const m of members) {
    const action = { email: m.email };
    try {
      // Ledger insert first — unique index gives atomic idempotency.
      const ledgerResp = await sb(serviceKey, "birthday_bonus_ledger", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          tenant_id: tenantId,
          member_email: m.email,
          bonus_year: year,
          credit_issued: creditAmount > 0 ? creditAmount : null,
          hours_issued: bonusHours > 0 ? bonusHours : null,
        }),
      });
      if (ledgerResp.status === 409) {
        action.action = "already_issued";
        report.push(action);
        continue;
      }
      if (!ledgerResp.ok) {
        throw new Error(`ledger insert ${ledgerResp.status}: ${await ledgerResp.text()}`);
      }

      // Credit path
      if (creditAmount > 0) {
        const currentBalance = Number(m.shop_credit_balance || 0);
        const newBalance = Math.round((currentBalance + creditAmount) * 100) / 100;
        await sb(serviceKey, `members?tenant_id=eq.${tenantId}&email=eq.${encodeURIComponent(m.email)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ shop_credit_balance: newBalance, updated_at: new Date().toISOString() }),
        });
        await sb(serviceKey, "shop_credits", {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            tenant_id: tenantId,
            member_email: m.email,
            amount: creditAmount,
            type: "credit",
            reason: `Happy birthday! Bonus credit (${year})`,
          }),
        });

        // Mirror onto Square gift card if one exists for this member.
        if (squareCreds && m.square_gift_card_id) {
          try {
            await adjustGiftCard({
              apiBase: squareCreds.apiBase,
              accessToken: squareCreds.accessToken,
              locationId: squareCreds.locationId,
              giftCardId: m.square_gift_card_id,
              deltaCents: Math.round(creditAmount * 100),
              direction: "INCREMENT",
              reason: "OTHER",
              idempotencyKey: `bday-${m.email}-${year}`,
            });
          } catch (e) {
            console.error(`birthday-bonus: gift card increment failed for ${m.email}:`, e.message);
          }
        }
      }

      // Hours path
      if (bonusHours > 0) {
        const currentHours = Number(m.bonus_hours || 0);
        const newHours = Math.round((currentHours + bonusHours) * 100) / 100;
        const reconcileMonth = billingMonth.slice(0, 7);
        await sb(serviceKey, `members?tenant_id=eq.${tenantId}&email=eq.${encodeURIComponent(m.email)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            bonus_hours: newHours,
            bonus_reconciled_month: reconcileMonth,
            updated_at: new Date().toISOString(),
          }),
        });
      }

      issued += 1;
      action.action = "issued";
      action.credit = creditAmount > 0 ? creditAmount : null;
      action.hours = bonusHours > 0 ? bonusHours : null;
      report.push(action);
    } catch (e) {
      action.action = "error";
      action.detail = e.message?.slice(0, 500) || "unknown";
      report.push(action);
    }
  }

  return {
    skipped: false,
    date,
    candidates: members.length,
    issued,
    creditAmount,
    bonusHours,
    report,
  };
}
