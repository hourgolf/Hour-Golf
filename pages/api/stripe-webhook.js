// Legacy single-tenant Stripe webhook endpoint (Phase 2B-3 era).
//
// Hour Golf's Stripe dashboard still points at /api/stripe-webhook with the
// env-var signing secret. Phase 7C introduced a per-tenant route at
// /api/stripe-webhook/[slug] with tenant-scoped signing secrets. Once HG's
// Stripe dashboard is cut over to the new URL and we've observed for ~24h,
// this file is deleted (Phase 7C-3).
//
// Until then, this shim keeps HG traffic flowing. It delegates to the same
// shared handler as the new route so bug fixes made in one place apply in
// both. The only differences from the new route:
//   - signing secret comes from process.env.STRIPE_WEBHOOK_SECRET
//   - Stripe client uses process.env.STRIPE_SECRET_KEY
//   - tenantId is hardcoded to Hour Golf
//
// Safe to remove once Stripe dashboard points at /api/stripe-webhook/hourgolf.

import Stripe from "stripe";
import { getServiceKey, getRequestOrigin } from "../../lib/api-helpers";
import { HOURGOLF_TENANT_ID } from "../../lib/constants";
import { handleStripeEvent, getRawBody } from "../../lib/stripe-webhook-handler";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Stripe signature verification requires the raw bytes.
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const serviceKey = getServiceKey();
  if (!serviceKey) return res.status(500).json({ error: "Server configuration error" });

  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    console.error("Missing stripe-signature or STRIPE_WEBHOOK_SECRET");
    return res.status(400).json({ error: "Missing signature" });
  }

  let event;
  try {
    const buf = await getRawBody(req);
    event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
  } catch (e) {
    console.error("Webhook signature verification failed:", e.message);
    return res.status(400).json({ error: "Invalid signature" });
  }

  console.log(`Stripe webhook (legacy): ${event.type} (${event.id})`);

  try {
    await handleStripeEvent({
      event,
      stripe,
      tenantId: HOURGOLF_TENANT_ID,
      serviceKey,
      portalUrl: getRequestOrigin(req),
    });
  } catch (e) {
    console.error(`Webhook processing error for ${event.type}:`, e);
  }

  return res.status(200).json({ received: true });
}
