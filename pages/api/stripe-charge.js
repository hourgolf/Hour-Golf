import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Simple auth: require the Supabase anon key as a bearer token
  // This prevents random people from hitting the endpoint
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");
  if (token !== process.env.SUPABASE_ANON_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { stripe_customer_id, amount_cents, description, member_email, billing_month } = req.body;

  if (!stripe_customer_id || !amount_cents || amount_cents < 50) {
    return res.status(400).json({ error: "Missing stripe_customer_id or amount_cents (minimum 50 = $0.50)" });
  }

  try {
    // 1. Get the customer's default payment method
    const customer = await stripe.customers.retrieve(stripe_customer_id);
    
    const defaultPaymentMethod =
      customer.invoice_settings?.default_payment_method ||
      customer.default_source;

    if (!defaultPaymentMethod) {
      return res.status(400).json({
        error: "No payment method on file",
        detail: `Stripe customer ${stripe_customer_id} has no default payment method. They may need to update their card.`,
      });
    }

    // 2. Create and confirm a PaymentIntent (charges immediately)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount_cents),
      currency: "usd",
      customer: stripe_customer_id,
      payment_method: defaultPaymentMethod,
      off_session: true,
      confirm: true,
      description: description || "Hour Golf overage charge",
      metadata: {
        member_email: member_email || "",
        billing_month: billing_month || "",
        source: "hour-golf-dashboard",
      },
    });

    // 3. Return success
    return res.status(200).json({
      success: true,
      payment_intent_id: paymentIntent.id,
      amount: paymentIntent.amount,
      status: paymentIntent.status,
    });

  } catch (err) {
    console.error("Stripe charge error:", err);

    // Handle specific Stripe errors
    if (err.type === "StripeCardError") {
      return res.status(400).json({
        error: "Card declined",
        detail: err.message,
        code: err.code,
      });
    }

    return res.status(500).json({
      error: "Charge failed",
      detail: err.message,
    });
  }
}
