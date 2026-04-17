import { verifyAdmin } from "../../lib/api-helpers";
import { getStripeClient } from "../../lib/stripe-config";

// Phase 7B-1: Stripe client is now resolved per request from the tenant's
// row in public.tenant_stripe_config instead of a module-scope singleton
// reading process.env.STRIPE_SECRET_KEY. Read-only route — lowest risk
// refactor to validate the Phase 7A helper end-to-end against a live
// code path for Hour Golf.

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { user, tenantId, reason } = await verifyAdmin(req);
  if (!user) {
    console.error("stripe-lookup verifyAdmin failed:", reason);
    return res.status(401).json({ error: "Unauthorized", detail: reason });
  }

  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Missing email" });

  let stripe;
  try {
    stripe = await getStripeClient(tenantId);
  } catch (err) {
    // No tenant_stripe_config row or enabled=false. Admin UI should render
    // a "Stripe not configured yet, ask platform admin" message.
    console.error("stripe-lookup getStripeClient failed:", err?.message || err);
    return res.status(503).json({
      error: "stripe_not_configured",
      detail: "Stripe is not set up for this tenant yet.",
    });
  }

  try {
    const customers = await stripe.customers.list({ email: email.toLowerCase().trim(), limit: 5 });

    if (customers.data.length === 0) return res.status(200).json({ found: false, customers: [] });

    const results = customers.data.map((c) => ({
      id: c.id,
      email: c.email,
      name: c.name,
      has_payment_method: !!(c.invoice_settings?.default_payment_method || c.default_source),
      created: c.created,
    }));

    return res.status(200).json({ found: true, customers: results });
  } catch (err) {
    console.error("Stripe lookup error:", err);
    return res.status(500).json({ error: "Lookup failed", detail: err.message });
  }
}
