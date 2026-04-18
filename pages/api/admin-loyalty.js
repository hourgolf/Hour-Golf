import { verifyAdmin, getServiceKey, SUPABASE_URL } from "../../lib/api-helpers";
import { assertFeature } from "../../lib/feature-guard";

function sb(key, path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(opts.headers || {}),
    },
  });
}

export default async function handler(req, res) {
  const { user, tenantId, reason } = await verifyAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  if (!(await assertFeature(res, tenantId, "loyalty"))) return;

  try {
    // ── GET: rules + recent ledger ──
    if (req.method === "GET") {
      const rulesResp = await sb(key, `loyalty_rules?tenant_id=eq.${tenantId}&order=rule_type.asc`);
      const rules = rulesResp.ok ? await rulesResp.json() : [];

      const ledgerResp = await sb(key, `loyalty_ledger?tenant_id=eq.${tenantId}&order=created_at.desc&limit=50`);
      const ledger = ledgerResp.ok ? await ledgerResp.json() : [];

      return res.status(200).json({ rules, ledger });
    }

    // ── PATCH: update rule ──
    if (req.method === "PATCH") {
      const id = req.query.id || req.body.id;
      if (!id) return res.status(400).json({ error: "Rule ID required" });

      const { threshold, reward, enabled } = req.body;
      const update = { updated_at: new Date().toISOString() };
      if (threshold !== undefined) update.threshold = Number(threshold);
      if (reward !== undefined) update.reward = Number(reward);
      if (enabled !== undefined) update.enabled = !!enabled;

      const r = await sb(key, `loyalty_rules?id=eq.${id}&tenant_id=eq.${tenantId}`, {
        method: "PATCH",
        body: JSON.stringify(update),
      });
      if (!r.ok) throw new Error(await r.text());
      const rows = await r.json();
      return res.status(200).json(rows[0]);
    }

    // ── POST action=process: run loyalty for a month ──
    if (req.method === "POST") {
      const { month } = req.body || {};
      if (!month) return res.status(400).json({ error: "month required (YYYY-MM)" });

      // Period format: "2026-04"
      const period = month.slice(0, 7);
      const [yr, mo] = period.split("-").map(Number);
      const monthStart = new Date(Date.UTC(yr, mo - 1, 1)).toISOString();
      const monthEnd = new Date(Date.UTC(yr, mo, 1)).toISOString();

      // Fetch enabled rules within this tenant
      const rulesResp = await sb(key, `loyalty_rules?tenant_id=eq.${tenantId}&enabled=eq.true`);
      const rules = rulesResp.ok ? await rulesResp.json() : [];
      if (!rules.length) return res.status(200).json({ processed: 0, message: "No enabled rules" });

      // Fetch active members within this tenant
      const memResp = await sb(key, `members?tenant_id=eq.${tenantId}&tier=neq.Non-Member&select=email,name,shop_credit_balance`);
      const members = memResp.ok ? await memResp.json() : [];
      if (!members.length) return res.status(200).json({ processed: 0, message: "No members" });

      // Fetch existing ledger entries for this period to prevent double-issue
      const ledgerResp = await sb(key, `loyalty_ledger?tenant_id=eq.${tenantId}&period=eq.${period}&select=member_email,rule_type`);
      const existingLedger = new Set((ledgerResp.ok ? await ledgerResp.json() : []).map((l) => `${l.member_email}|${l.rule_type}`));

      // Fetch bookings for the month
      const bkResp = await sb(key, `bookings?tenant_id=eq.${tenantId}&booking_status=eq.Confirmed&booking_start=gte.${monthStart}&booking_start=lt.${monthEnd}&select=customer_email,duration_hours`);
      const bookings = bkResp.ok ? await bkResp.json() : [];

      // Aggregate booking data per member
      const memberHours = {};
      const memberBookings = {};
      bookings.forEach((b) => {
        memberHours[b.customer_email] = (memberHours[b.customer_email] || 0) + Number(b.duration_hours || 0);
        memberBookings[b.customer_email] = (memberBookings[b.customer_email] || 0) + 1;
      });

      // Fetch shop orders for the month within this tenant
      const ordResp = await sb(key, `shop_orders?tenant_id=eq.${tenantId}&status=eq.confirmed&created_at=gte.${monthStart}&created_at=lt.${monthEnd}&select=member_email,total`);
      const orders = ordResp.ok ? await ordResp.json() : [];

      const memberSpend = {};
      orders.forEach((o) => {
        memberSpend[o.member_email] = (memberSpend[o.member_email] || 0) + Number(o.total || 0);
      });

      // Fold in-store Square POS purchases into shop_spend, net of any
      // refunds recorded against them. Filtering on billing_month keeps
      // the window consistent with shop_orders.created_at. Refunds
      // arriving AFTER this run don't claw back issued credit — the
      // ledger dedup further down prevents re-processing — but they
      // reduce future runs for that month if an admin re-triggers.
      const sqResp = await sb(key, `payments?tenant_id=eq.${tenantId}&source=eq.square_pos&status=eq.succeeded&billing_month=gte.${monthStart}&billing_month=lt.${monthEnd}&select=member_email,amount_cents,refunded_cents`);
      const squareRows = sqResp.ok ? await sqResp.json() : [];
      squareRows.forEach((r) => {
        const net = Math.max(
          0,
          Number(r.amount_cents || 0) - Number(r.refunded_cents || 0)
        );
        if (net > 0 && r.member_email) {
          memberSpend[r.member_email] = (memberSpend[r.member_email] || 0) + net / 100;
        }
      });

      // Process each member against each rule
      let totalIssued = 0;
      let membersAffected = new Set();
      const results = [];

      for (const member of members) {
        for (const rule of rules) {
          const ledgerKey = `${member.email}|${rule.rule_type}`;
          if (existingLedger.has(ledgerKey)) continue; // Already processed

          let progress = 0;
          if (rule.rule_type === "hours") progress = memberHours[member.email] || 0;
          else if (rule.rule_type === "bookings") progress = memberBookings[member.email] || 0;
          else if (rule.rule_type === "shop_spend") progress = memberSpend[member.email] || 0;

          const earned = progress >= rule.threshold;
          const rewardAmt = earned ? Number(rule.reward) : 0;

          // Record in ledger (even if no reward, to track progress)
          await sb(key, "loyalty_ledger", {
            method: "POST",
            body: JSON.stringify({
              tenant_id: tenantId,
              member_email: member.email,
              rule_type: rule.rule_type,
              period,
              progress: Math.round(progress * 100) / 100,
              reward_issued: rewardAmt,
            }),
          });

          // Issue credit if earned
          if (earned && rewardAmt > 0) {
            const currentBalance = Number(member.shop_credit_balance || 0);
            const newBalance = Math.round((currentBalance + rewardAmt) * 100) / 100;

            await sb(key, `members?email=eq.${encodeURIComponent(member.email)}&tenant_id=eq.${tenantId}`, {
              method: "PATCH",
              body: JSON.stringify({ shop_credit_balance: newBalance, updated_at: new Date().toISOString() }),
            });

            // Update local reference for subsequent rules
            member.shop_credit_balance = newBalance;

            await sb(key, "shop_credits", {
              method: "POST",
              body: JSON.stringify({
                tenant_id: tenantId,
                member_email: member.email,
                amount: rewardAmt,
                type: "credit",
                reason: `Loyalty reward — ${rule.rule_type === "hours" ? `${progress.toFixed(1)}h booked` : rule.rule_type === "bookings" ? `${progress} bookings` : `$${progress.toFixed(0)} spent`} in ${period}`,
              }),
            });

            totalIssued += rewardAmt;
            membersAffected.add(member.email);
            results.push({ email: member.email, name: member.name, rule: rule.rule_type, progress, reward: rewardAmt });
          }
        }
      }

      return res.status(200).json({
        processed: members.length,
        rules_active: rules.length,
        credits_issued: totalIssued,
        members_affected: membersAffected.size,
        period,
        details: results,
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("admin-loyalty error:", e);
    return res.status(500).json({ error: e.message });
  }
}
