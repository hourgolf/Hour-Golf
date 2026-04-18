// Per-tenant Square webhook endpoint.
//
// URL shape: https://<slug>.ourlee.co/api/square-webhook/<slug>
// e.g. https://hourgolf.ourlee.co/api/square-webhook/hourgolf
//
// Each tenant creates a webhook subscription in their Square Developer
// Dashboard pointing to this URL. Square generates a signature key at
// subscription time; paste that into
// /platform/tenants/<slug> → Square → Webhook signature key.
//
// Signature verification: HMAC-SHA256 over (notificationUrl + rawBody)
// using the per-tenant webhook_signature_key, base64-encoded, compared
// against x-square-hmacsha256-signature.

import { SUPABASE_URL, getServiceKey } from "../../../lib/api-helpers";
import { loadSquareConfig } from "../../../lib/square-config";
import {
  verifySquareSignature,
  getRawBody,
  handleSquareEvent,
} from "../../../lib/square-webhook";

// Signature verification needs the raw bytes, same as the Stripe webhook.
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { slug } = req.query;
  if (!slug || typeof slug !== "string") {
    return res.status(400).json({ error: "Missing tenant slug" });
  }

  const serviceKey = getServiceKey();
  if (!serviceKey) {
    console.error("square-webhook[slug]: SUPABASE_SERVICE_ROLE_KEY not set");
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
    console.error(`square-webhook[${slug}]: tenant lookup failed:`, e);
    return res.status(500).json({ error: "Tenant lookup failed" });
  }

  if (!tenantId) {
    return res.status(404).json({ error: `Unknown tenant: ${slug}` });
  }

  // 2. Load per-tenant config — need webhook_signature_key.
  const cfg = await loadSquareConfig(tenantId);
  if (!cfg || !cfg.webhook_signature_key) {
    console.error(`square-webhook[${slug}]: no webhook_signature_key for tenant ${tenantId}`);
    return res.status(400).json({ error: "Webhook not configured for this tenant" });
  }
  if (!cfg.enabled) {
    return res.status(503).json({ error: "Square not enabled for this tenant" });
  }

  // 3. Verify signature.
  const headerValue = req.headers["x-square-hmacsha256-signature"];
  if (!headerValue) {
    return res.status(400).json({ error: "Missing signature header" });
  }

  // Square signs over the exact URL it POSTed to. Reconstruct it from
  // the forwarded host + path (Vercel / Next.js expose both; the
  // X-Forwarded-Proto / Host pair matches what Square actually called).
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const notificationUrl = `${proto}://${host}${req.url}`;

  const rawBody = await getRawBody(req);

  const ok = verifySquareSignature({
    signingKey: cfg.webhook_signature_key,
    notificationUrl,
    rawBody,
    headerValue: Array.isArray(headerValue) ? headerValue[0] : headerValue,
  });
  if (!ok) {
    console.error(`square-webhook[${slug}]: signature verification failed`);
    return res.status(400).json({ error: "Invalid signature" });
  }

  // 4. Parse body + dispatch.
  let event;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch (e) {
    return res.status(400).json({ error: "Malformed JSON body" });
  }

  console.log(`Square webhook[${slug}]: ${event.type} (${event.event_id || "?"})`);

  try {
    const result = await handleSquareEvent({ event, tenantId, serviceKey });
    if (result && !result.handled) {
      console.log(`square-webhook[${slug}] not handled: ${result.reason}`);
    }
  } catch (e) {
    // Log and still 200 so Square doesn't mark the endpoint as failing.
    console.error(`square-webhook[${slug}] processing error:`, e);
  }

  return res.status(200).json({ received: true });
}
