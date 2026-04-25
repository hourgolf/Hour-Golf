import { SUPABASE_URL, getServiceKey, verifyAdmin } from "../../lib/api-helpers";
import { getStripeClient } from "../../lib/stripe-config";
import { logActivity } from "../../lib/activity-log";

// Admin-only tier update / member upsert.
//
// Replaces the direct PostgREST PATCH/POST that pages/index.js used
// to do client-side. Two reasons:
//
//   1. The members RLS policy gates INSERT on a JWT match against the
//      admins table — but the client wasn't always carrying a JWT
//      shape Postgres accepted, so first-time member creates from the
//      admin Customers tab failed with 42501 ("row-level security
//      policy violation"). The client could PATCH existing rows (via
//      the admin_all SELECT path's residual cache?) but not INSERT.
//      Service-role on the server bypasses RLS cleanly.
//
//   2. When admin sets a member to a paying tier, we should ALSO
//      look up Stripe by email and link the existing customer +
//      subscription if there is one. This prevents the operator
//      from accidentally creating a duplicate Stripe charge later
//      (the subscription is already paying; we just record the link).
//      No Stripe write happens — only reads. Tier change here never
//      triggers a checkout.
//
// Body: { email, tier, name?, retroactive? }
// Response: 200 { member, linked_stripe, retroactive_bookings_updated? }
//
// retroactive=true also updates bookings.tier on the member's
// confirmed bookings from the last 60 days so the snapshot reflects
// the corrected tier (used when a tier change is fixing a data error
// rather than a real upgrade/downgrade — see lessons memory note on
// duplicate-customer merges).

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { user, tenantId, reason } = await verifyAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const { email, tier, name, retroactive } = req.body || {};
  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "email required" });
  }
  if (!tier || typeof tier !== "string") {
    return res.status(400).json({ error: "tier required" });
  }
  const wantsRetro = retroactive === true;

  const cleanEmail = email.toLowerCase().trim();

  try {
    // Look up the existing row.
    const exResp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(cleanEmail)}&tenant_id=eq.${tenantId}&select=id,email,name,tier,stripe_customer_id,stripe_subscription_id`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!exResp.ok) throw new Error(`Member lookup failed: ${exResp.status}`);
    const exRows = await exResp.json();
    const existing = exRows[0] || null;

    // Optional Stripe lookup. Only when:
    //   - Setting a paying tier (≠ Non-Member)
    //   - The row doesn't already have stripe_customer_id linked
    // Read-only: never creates or modifies a Stripe object here.
    let stripeLink = {};
    if (tier !== "Non-Member" && (!existing || !existing.stripe_customer_id)) {
      try {
        const stripe = await getStripeClient(tenantId);
        if (stripe) {
          // Email is case-sensitive in customers.list; use search API.
          const searchEscaped = cleanEmail.replace(/'/g, "\\'");
          const searchResp = await stripe.customers.search({
            query: `email:'${searchEscaped}'`,
            limit: 1,
          });
          const cust = searchResp?.data?.[0] || null;
          if (cust) {
            stripeLink.stripe_customer_id = cust.id;
            // Find an active subscription on that customer.
            try {
              const subs = await stripe.subscriptions.list({
                customer: cust.id,
                status: "active",
                limit: 1,
              });
              const sub = subs?.data?.[0] || null;
              if (sub) {
                stripeLink.stripe_subscription_id = sub.id;
                stripeLink.stripe_price_id = sub.items?.data?.[0]?.price?.id || null;
              }
            } catch (_) { /* sub lookup non-fatal */ }
          }
        }
      } catch (e) {
        // Stripe lookup is best-effort — don't fail the tier update.
        console.warn("admin-update-tier: Stripe link lookup failed:", e.message);
      }
    }

    if (existing) {
      // Update path. Patch tier (+ Stripe link if discovered).
      const patch = { tier, updated_at: new Date().toISOString(), ...stripeLink };
      const upResp = await fetch(
        `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(cleanEmail)}&tenant_id=eq.${tenantId}`,
        {
          method: "PATCH",
          headers: {
            apikey: key, Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: JSON.stringify(patch),
        }
      );
      if (!upResp.ok) {
        const text = await upResp.text();
        return res.status(500).json({ error: "Update failed", detail: text });
      }
      const rows = await upResp.json();

      // Optional retroactive booking re-tier. Scoped to this member,
      // last 60 days, non-cancelled bookings only. Used when fixing a
      // data error (e.g. duplicate-account merge resolved into a
      // different canonical tier) rather than a real upgrade/downgrade.
      // Bumps each affected row to the new tier so the InboxView's
      // "non-members to charge" calculation stops surfacing stale
      // snapshots.
      let retroBookingsUpdated = 0;
      if (wantsRetro) {
        // Pacific-zone "now minus 60 days" — bookings.booking_start is
        // stored in UTC ISO so a JS Date comparison via ISO string is
        // correct without needing a TZ math.
        const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
        const reResp = await fetch(
          `${SUPABASE_URL}/rest/v1/bookings?customer_email=eq.${encodeURIComponent(cleanEmail)}&tenant_id=eq.${tenantId}&booking_status=neq.Cancelled&booking_start=gte.${encodeURIComponent(cutoff)}`,
          {
            method: "PATCH",
            headers: {
              apikey: key, Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
              Prefer: "return=representation",
            },
            body: JSON.stringify({ tier }),
          }
        );
        if (reResp.ok) {
          const updated = await reResp.json();
          retroBookingsUpdated = Array.isArray(updated) ? updated.length : 0;
        } else {
          // Non-fatal — the member tier change already succeeded.
          // Surface in logs but don't blow up the response.
          console.warn("admin-update-tier: retroactive bookings update failed:", await reResp.text().catch(() => ""));
        }
      }

      if (existing.tier !== tier || retroBookingsUpdated > 0) {
        await logActivity({
          tenantId,
          actor: { id: user.id, email: user.email },
          action: "member.tier_changed",
          targetType: "member",
          targetId: cleanEmail,
          metadata: {
            from: existing.tier || null,
            to: tier,
            linked_stripe: !!stripeLink.stripe_customer_id,
            retroactive: wantsRetro,
            retroactive_bookings_updated: retroBookingsUpdated,
          },
        });
      }

      return res.status(200).json({
        member: rows[0] || null,
        linked_stripe: !!stripeLink.stripe_customer_id,
        retroactive_bookings_updated: retroBookingsUpdated,
      });
    }

    // Insert path. NOT NULL columns: tenant_id, email, name, tier.
    // Pick a sensible name fallback: explicit > stripe-derived > email
    // local-part titlecased > email.
    const fallbackName = name?.trim()
      || stripeLink._stripeName
      || cleanEmail.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
      || cleanEmail;

    const inResp = await fetch(`${SUPABASE_URL}/rest/v1/members`, {
      method: "POST",
      headers: {
        apikey: key, Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        tenant_id: tenantId,
        email: cleanEmail,
        name: fallbackName,
        tier,
        join_date: new Date().toISOString().slice(0, 10),
        ...stripeLink,
      }),
    });
    if (!inResp.ok) {
      const text = await inResp.text();
      return res.status(500).json({ error: "Insert failed", detail: text });
    }
    const rows = await inResp.json();

    await logActivity({
      tenantId,
      actor: { id: user.id, email: user.email },
      action: "member.created",
      targetType: "member",
      targetId: cleanEmail,
      metadata: {
        tier,
        name: fallbackName,
        linked_stripe: !!stripeLink.stripe_customer_id,
      },
    });

    return res.status(200).json({ member: rows[0] || null, linked_stripe: !!stripeLink.stripe_customer_id });
  } catch (e) {
    console.error("admin-update-tier error:", e);
    return res.status(500).json({ error: "Internal error", detail: e.message });
  }
}
