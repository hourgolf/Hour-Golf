import { verifyAdmin, getServiceKey, SUPABASE_URL } from "../../lib/api-helpers";
import { getStripeClient } from "../../lib/stripe-config";

// Phase 7B-2a: per-tenant Stripe client via lib/stripe-config.
// Also server-owns the payments table INSERT now — previously the client
// did it post-charge in pages/index.js, which failed after Phase 2C dropped
// the payments.tenant_id DEFAULT (null constraint violation). Server-side
// INSERT is atomic with the charge and always has tenantId from verifyAdmin.

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { user, tenantId, reason } = await verifyAdmin(req);
  if (!user) {
    console.error("stripe-charge verifyAdmin failed:", reason);
    return res.status(401).json({ error: "Unauthorized", detail: reason });
  }

  const { stripe_customer_id, amount_cents, description, member_email, billing_month } = req.body;

  if (!stripe_customer_id || !amount_cents || amount_cents < 50) {
    return res.status(400).json({ error: "Missing stripe_customer_id or amount_cents (min 50)" });
  }

  let stripe;
  try {
    stripe = await getStripeClient(tenantId);
  } catch (err) {
    console.error("stripe-charge getStripeClient failed:", err?.message || err);
    return res.status(503).json({
      error: "stripe_not_configured",
      detail: "Stripe is not set up for this tenant yet.",
    });
  }

  try {
    const customer = await stripe.customers.retrieve(stripe_customer_id);

    // Try multiple ways to find a payment method:
    // 1. Invoice settings default
    // 2. Customer default source  
    // 3. List all attached payment methods and use the most recent
    let paymentMethod =
      customer.invoice_settings?.default_payment_method ||
      customer.default_source;

    if (!paymentMethod) {
      const methods = await stripe.paymentMethods.list({
        customer: stripe_customer_id,
        type: "card",
        limit: 5,
      });
      if (methods.data.length > 0) {
        paymentMethod = methods.data[0].id;
      }
    }

    if (!paymentMethod) {
      // Check older sources API
      const full = await stripe.customers.retrieve(stripe_customer_id, {
        expand: ["sources"],
      });
      if (full.sources?.data?.length > 0) {
        paymentMethod = full.sources.data[0].id;
      }
    }

    if (!paymentMethod) {
      return res.status(400).json({
        error: "No payment method found",
        detail: `No cards attached to ${customer.email}. They may need to rebook through Skedda to re-save their card.`,
      });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount_cents),
      currency: "usd",
      customer: stripe_customer_id,
      payment_method: paymentMethod,
      off_session: true,
      confirm: true,
      description: description || "Hour Golf charge",
      metadata: {
        member_email: member_email || "",
        billing_month: billing_month || "",
        tenant_id: tenantId,
        source: "hour-golf-dashboard",
      },
    });

    // Record in our payments table. This used to live client-side in
    // pages/index.js, but it failed after Phase 2C dropped
    // payments.tenant_id DEFAULT (the client had no way to set it). Now the
    // API route owns the INSERT with tenantId from verifyAdmin.
    //
    // If Stripe succeeded but this INSERT fails, the charge is already
    // captured. Log loudly and return a warning so the UI can flag it — but
    // don't fail the whole response, since the customer was already charged.
    const key = getServiceKey();
    let paymentsInsertOk = true;
    let paymentsInsertError = null;
    if (key) {
      try {
        const dbDescription =
          typeof description === "string" && description.startsWith("Hour Golf overage")
            ? description.replace(/^Hour Golf overage/, "Overage")
            : description || "Charge";
        const insertResp = await fetch(`${SUPABASE_URL}/rest/v1/payments`, {
          method: "POST",
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            tenant_id: tenantId,
            member_email: member_email || null,
            billing_month: billing_month || null,
            amount_cents: Math.round(amount_cents),
            stripe_payment_intent_id: paymentIntent.id,
            status: "succeeded",
            description: dbDescription,
          }),
        });
        if (!insertResp.ok) {
          paymentsInsertOk = false;
          paymentsInsertError = `status_${insertResp.status}`;
          const body = await insertResp.text();
          console.error("stripe-charge payments INSERT failed:", insertResp.status, body);
        }
      } catch (err) {
        paymentsInsertOk = false;
        paymentsInsertError = err?.message || String(err);
        console.error("stripe-charge payments INSERT exception:", err);
      }
    } else {
      paymentsInsertOk = false;
      paymentsInsertError = "missing_service_key";
      console.error("stripe-charge: SUPABASE_SERVICE_ROLE_KEY not set; payments row not recorded.");
    }

    return res.status(200).json({
      success: true,
      payment_intent_id: paymentIntent.id,
      amount: paymentIntent.amount,
      status: paymentIntent.status,
      payments_row_recorded: paymentsInsertOk,
      payments_row_error: paymentsInsertError,
    });
  } catch (err) {
    console.error("Stripe charge error:", err);
    if (err.type === "StripeCardError") {
      return res.status(400).json({ error: "Card declined", detail: err.message, code: err.code });
    }
    return res.status(500).json({ error: "Charge failed", detail: err.message });
  }
}
