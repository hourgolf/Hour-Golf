import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");
  if (token !== process.env.SUPABASE_ANON_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Missing email" });
  }

  try {
    // Search Stripe for customers matching this email
    const customers = await stripe.customers.list({
      email: email.toLowerCase().trim(),
      limit: 5,
    });

    if (customers.data.length === 0) {
      return res.status(200).json({ found: false, customers: [] });
    }

    // Return matching customers with payment method info
    const results = customers.data.map((c) => ({
      id: c.id,
      email: c.email,
      name: c.name,
      has_payment_method: !!(
        c.invoice_settings?.default_payment_method || c.default_source
      ),
      created: c.created,
    }));

    return res.status(200).json({ found: true, customers: results });
  } catch (err) {
    console.error("Stripe lookup error:", err);
    return res.status(500).json({ error: "Lookup failed", detail: err.message });
  }
}
