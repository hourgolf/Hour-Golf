// Per-tenant Stripe webhook endpoint (Phase 7C).
//
// URL shape: /api/stripe-webhook/<tenant-slug>
//   e.g. https://hourgolf.ourlee.co/api/stripe-webhook/hourgolf
//
// Each tenant configures their own webhook endpoint in their Stripe dashboard
// pointing at this URL, with a unique signing secret stored per-tenant in
// tenant_stripe_config.webhook_secret. The legacy single-tenant endpoint at
// /api/stripe-webhook (HG-only, env-var secret) stays live during the
// observation window, then is deleted in Phase 7C-3.

import { SUPABASE_URL, getServiceKey, getRequestOrigin } from "../../../lib/api-helpers";
import { getStripeClient, loadStripeConfig } from "../../../lib/stripe-config";
import { handleStripeEvent, getRawBody } from "../../../lib/stripe-webhook-handler";

// Stripe signature verification requires the raw bytes.
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { slug } = req.query;
  if (!slug || typeof slug !== "string") {
    return res.status(400).json({ error: "Missing tenant slug" });
  }

  const serviceKey = getServiceKey();
  if (!serviceKey) {
    console.error("stripe-webhook[slug]: SUPABASE_SERVICE_ROLE_KEY not set");
    return res.status(500).json({ error: "Server configuration error" });
  }

  // 1. Resolve slug → active tenant.
  let tenantId = null;
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/tenants?slug=eq.${encodeURIComponent(slug)}&status=eq.active&select=id`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    if (resp.ok) {
      const rows = await resp.json();
      if (Array.isArray(rows) && rows.length > 0) {
        tenantId = rows[0].id;
      }
    }
  } catch (e) {
    console.error(`stripe-webhook[${slug}]: tenant lookup failed:`, e);
    return res.status(500).json({ error: "Tenant lookup failed" });
  }

  if (!tenantId) {
    // Unknown or suspended tenant. Return 404 so Stripe flags the endpoint
    // in the dashboard instead of silently retrying forever.
    return res.status(404).json({ error: `Unknown tenant: ${slug}` });
  }

  // 2. Load the tenant's Stripe config for the webhook signing secret.
  const cfg = await loadStripeConfig(tenantId);
  if (!cfg || !cfg.webhook_secret) {
    console.error(`stripe-webhook[${slug}]: no webhook_secret configured for tenant ${tenantId}`);
    return res.status(400).json({ error: "Webhook not configured for this tenant" });
  }

  // 3. Verify signature with the per-tenant secret.
  const sig = req.headers["stripe-signature"];
  if (!sig) {
    return res.status(400).json({ error: "Missing signature" });
  }

  // getStripeClient both validates enabled=true and returns a client pinned
  // to the tenant's secret_key. We use the same client for signature
  // verification (constructEvent is a static method but reusing the per-
  // tenant instance keeps us honest that we never fall back to a global).
  let stripe;
  try {
    stripe = await getStripeClient(tenantId);
  } catch (e) {
    console.error(`stripe-webhook[${slug}]: getStripeClient failed:`, e.message);
    return res.status(503).json({ error: "Stripe not enabled for this tenant" });
  }

  let event;
  try {
    const buf = await getRawBody(req);
    event = stripe.webhooks.constructEvent(buf, sig, cfg.webhook_secret);
  } catch (e) {
    console.error(`stripe-webhook[${slug}]: signature verification failed:`, e.message);
    return res.status(400).json({ error: "Invalid signature" });
  }

  console.log(`Stripe webhook[${slug}]: ${event.type} (${event.id})`);

  // 4. Dispatch to the shared handler. Any processing error is logged and
  //    we still 200 so Stripe doesn't mark this as a delivery failure.
  try {
    await handleStripeEvent({ event, stripe, tenantId, serviceKey, portalUrl: getRequestOrigin(req) });
  } catch (e) {
    console.error(`stripe-webhook[${slug}] processing error for ${event.type}:`, e);
  }

  return res.status(200).json({ received: true });
}
