import Stripe from "stripe";
import { verifyAdmin } from "../../lib/api-helpers";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const admin = await verifyAdmin(req);
  if (!admin) return res.status(401).json({ error: "Unauthorized" });

  const { stripe_customer_id, amount_cents, description, member_email, billing_month } = req.body;

  if (!stripe_customer_id || !amount_cents || amount_cents < 50) {
    return res.status(400).json({ error: "Missing stripe_customer_id or amount_cents (min 50)" });
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
        source: "hour-golf-dashboard",
      },
    });

    return res.status(200).json({
      success: true,
      payment_intent_id: paymentIntent.id,
      amount: paymentIntent.amount,
      status: paymentIntent.status,
    });
  } catch (err) {
    console.error("Stripe charge error:", err);
    if (err.type === "StripeCardError") {
      return res.status(400).json({ error: "Card declined", detail: err.message, code: err.code });
    }
    return res.status(500).json({ error: "Charge failed", detail: err.message });
  }
}
