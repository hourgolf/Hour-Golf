// /api/cron-abandoned-carts
//
// Daily cron. Finds members with carts older than 48h that haven't
// been reminded in the last 14 days, sends a branded reminder email,
// and stamps last_reminder_at to suppress repeats.
//
// Auth: Vercel sets CRON_SECRET as a system env var and attaches
// `Authorization: Bearer <CRON_SECRET>` to cron requests. Anything
// else gets a vague 401.
//
// Why 48h and 14d: the memory covers it — we want one nudge, not a
// drip sequence. Over-email kills the inbox relationship.

import { SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";
import { sendAbandonedCartEmail } from "../../lib/email";

export const config = { maxDuration: 60 };

const ABANDON_THRESHOLD_HOURS = 48;
const REMINDER_SUPPRESS_DAYS = 14;

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization || "";
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const now = Date.now();
  const abandonCutoff = new Date(now - ABANDON_THRESHOLD_HOURS * 60 * 60 * 1000).toISOString();
  const suppressCutoff = new Date(now - REMINDER_SUPPRESS_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const sb = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });

  try {
    // 1. Every cart row older than 48h. Filter reminder suppression
    //    in JS because PostgREST's OR + IS NULL syntax gets ugly.
    const cartResp = await sb(`shop_cart?created_at=lt.${encodeURIComponent(abandonCutoff)}&select=id,tenant_id,member_email,item_id,size,quantity,last_reminder_at,created_at`);
    if (!cartResp.ok) throw new Error(`Cart lookup failed: ${cartResp.status}`);
    const carts = await cartResp.json();

    // Skip rows that got a reminder in the suppression window.
    const eligible = carts.filter((c) => !c.last_reminder_at || c.last_reminder_at < suppressCutoff);
    if (eligible.length === 0) {
      return res.status(200).json({ reminded: 0, eligible: 0 });
    }

    // 2. Group by (tenant_id, member_email) so each member gets at
    //    most one email, even if their cart has multiple rows.
    const byMember = new Map();
    for (const c of eligible) {
      const key = `${c.tenant_id}||${c.member_email}`;
      if (!byMember.has(key)) byMember.set(key, { tenant_id: c.tenant_id, member_email: c.member_email, carts: [] });
      byMember.get(key).carts.push(c);
    }

    // 3. For each group, fetch member (for name + opt-in check) +
    //    items (for the email summary), send the email, stamp the
    //    cart rows' last_reminder_at.
    let reminded = 0;
    const failed = [];

    for (const group of byMember.values()) {
      try {
        // Member row — skip if member has opted out of billing/shop
        // emails. Reuses the email_billing pref from the launch
        // broadcast gate; we don't have a shop-specific pref yet.
        const mResp = await sb(`members?tenant_id=eq.${group.tenant_id}&email=eq.${encodeURIComponent(group.member_email)}&select=name,email,email_preferences`);
        const members = mResp.ok ? await mResp.json() : [];
        const member = members[0];
        if (!member) continue;
        const prefs = member.email_preferences || {};
        if (prefs.email_billing === false || prefs.email_marketing === false) {
          continue;
        }

        // Item details for the email body.
        const itemIds = [...new Set(group.carts.map((c) => c.item_id))];
        const itResp = await sb(`shop_items?id=in.(${itemIds.join(",")})&tenant_id=eq.${group.tenant_id}&select=id,title,price,sizes`);
        const items = itResp.ok ? await itResp.json() : [];
        const itemMap = {};
        items.forEach((i) => { itemMap[i.id] = i; });

        const summary = group.carts.map((c) => ({
          title: itemMap[c.item_id]?.title || "Shop item",
          size: c.size,
          quantity: c.quantity,
          lineTotal: Number(itemMap[c.item_id]?.price || 0) * (Number(c.quantity) || 0),
        }));
        const total = summary.reduce((s, x) => s + x.lineTotal, 0);
        if (total <= 0) continue;

        await sendAbandonedCartEmail({
          tenantId: group.tenant_id,
          to: group.member_email,
          customerName: member.name,
          items: summary,
          total,
        });

        // Stamp all of this member's cart rows so the next cron run
        // skips them until the 14-day suppression window expires.
        const stampIds = group.carts.map((c) => c.id);
        if (stampIds.length > 0) {
          await sb(`shop_cart?id=in.(${stampIds.join(",")})`, {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ last_reminder_at: new Date().toISOString() }),
          });
        }
        reminded++;
      } catch (e) {
        failed.push({ email: group.member_email, reason: e?.message || String(e) });
      }
    }

    return res.status(200).json({
      reminded,
      eligible: byMember.size,
      failed_count: failed.length,
      failures: failed.slice(0, 10),
    });
  } catch (e) {
    console.error("cron-abandoned-carts error:", e);
    return res.status(500).json({ error: "Cron failed", detail: e.message });
  }
}
