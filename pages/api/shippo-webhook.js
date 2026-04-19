// /api/shippo-webhook
//
// Receives tracking status updates from Shippo. Registered at the
// Shippo Dashboard → Webhooks (event: track_updated). Signed with
// an HMAC-SHA256 header (X-Shippo-Signature, hex-encoded) using the
// secret stored in tenant_shippo_config.tracking_webhook_secret.
//
// Multi-tenant resolution: Shippo webhooks don't carry a tenant id,
// so we identify the tenant by looking up the tracking number in
// shop_orders. First-match wins — tracking numbers are globally
// unique per carrier.
//
// On payload receive:
//   1. Parse body.
//   2. Find the shop_orders row by tracking_number.
//   3. Validate signature against that tenant's stored secret.
//   4. Update shipping_status + detail + timestamp on every row of
//      the purchase (all rows sharing the stripe_payment_intent_id).
//   5. If status transitions to "delivered" and we haven't notified
//      yet, send a delivery email to the member.

import crypto from "crypto";
import { SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";
import { loadShippoConfig } from "../../lib/shippo-config";
import { sendShipmentDeliveredEmail } from "../../lib/email";

// Raw bytes for HMAC verification. bodyParser must be OFF.
export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function verifySignature(secret, rawBody, headerValue) {
  if (!secret || !headerValue) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(headerValue).trim());
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch { return false; }
}

// Map Shippo's tracking_status.status values to our lowercased enum.
function normalizeStatus(shippoStatus) {
  const s = String(shippoStatus || "").toUpperCase();
  if (s === "DELIVERED") return "delivered";
  if (s === "RETURNED") return "returned";
  if (s === "FAILURE") return "failure";
  if (s === "TRANSIT") return "transit";
  if (s === "PRE_TRANSIT") return "pre_transit";
  if (s === "UNKNOWN") return "unknown";
  return s.toLowerCase() || "unknown";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const serviceKey = getServiceKey();
  if (!serviceKey) {
    console.error("shippo-webhook: SUPABASE_SERVICE_ROLE_KEY not set");
    return res.status(500).json({ error: "Server configuration error" });
  }

  const rawBody = await getRawBody(req);
  let body;
  try { body = JSON.parse(rawBody.toString("utf8")); }
  catch { return res.status(400).json({ error: "Malformed JSON body" }); }

  // The "track_updated" event payload shape (simplified):
  //   { event: "track_updated", data: { tracking_number, tracking_status: {...}, ... } }
  // Older shapes deliver at the top level. We accept either.
  const data = body?.data || body;
  const trackingNumber = data?.tracking_number;
  if (!trackingNumber) return res.status(400).json({ error: "Missing tracking_number" });

  const ts = data?.tracking_status || {};
  const statusRaw = ts.status;
  const statusDetail = ts.status_details || "";
  const statusDate = ts.status_date || null;

  // Resolve tenant by looking up the tracking number across orders.
  // We need tenant first so we can load the right webhook secret
  // before verifying — chicken-and-egg, resolved by looking up via
  // service role (which bypasses RLS). Privacy-safe because we only
  // return the tenant id and the member email we already need to
  // email.
  const orderResp = await fetch(
    `${SUPABASE_URL}/rest/v1/shop_orders?tracking_number=eq.${encodeURIComponent(trackingNumber)}&select=id,tenant_id,member_email,stripe_payment_intent_id,shipping_status,shipping_carrier,shipping_service,shipping_address,total&limit=1`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  if (!orderResp.ok) {
    console.error(`shippo-webhook: order lookup ${orderResp.status}`);
    return res.status(500).json({ error: "Order lookup failed" });
  }
  const orderRows = await orderResp.json();
  const firstRow = orderRows[0];
  if (!firstRow) {
    // Unknown tracking number — could be a label we didn't generate.
    // 200 so Shippo doesn't retry forever.
    console.log(`shippo-webhook: no order found for tracking ${trackingNumber}`);
    return res.status(200).json({ ignored: true });
  }

  const tenantId = firstRow.tenant_id;
  const cfg = await loadShippoConfig(tenantId);
  const secret = cfg?.tracking_webhook_secret;

  const headerValue = req.headers["x-shippo-signature"] || req.headers["x-shippo-signature-v1"];
  if (!verifySignature(secret, rawBody, headerValue)) {
    console.error(`shippo-webhook: signature verification failed for tenant ${tenantId}`);
    return res.status(400).json({ error: "Invalid signature" });
  }

  const newStatus = normalizeStatus(statusRaw);
  const prevStatus = firstRow.shipping_status || null;

  // Update every row of the purchase (they share stripe_payment_intent_id).
  const pi = firstRow.stripe_payment_intent_id;
  const patchTarget = pi
    ? `shop_orders?tenant_id=eq.${tenantId}&stripe_payment_intent_id=eq.${encodeURIComponent(pi)}`
    : `shop_orders?id=eq.${firstRow.id}`;
  await fetch(
    `${SUPABASE_URL}/rest/v1/${patchTarget}`,
    {
      method: "PATCH",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        shipping_status: newStatus,
        shipping_status_detail: statusDetail ? String(statusDetail).slice(0, 500) : null,
        shipping_status_updated_at: statusDate || new Date().toISOString(),
      }),
    }
  );

  console.log(`shippo-webhook: tenant ${tenantId} tracking ${trackingNumber} → ${newStatus}`);

  // Send delivered email on transition into "delivered". We key off
  // prevStatus so a re-delivery of the same webhook doesn't double-
  // email. If prevStatus was already "delivered", skip.
  if (newStatus === "delivered" && prevStatus !== "delivered") {
    try {
      await sendShipmentDeliveredEmail({
        tenantId,
        to: firstRow.member_email,
        trackingNumber,
        carrier: firstRow.shipping_carrier || null,
        service: firstRow.shipping_service || null,
      });
    } catch (e) {
      console.error(`shippo-webhook: delivered email failed for ${firstRow.member_email}:`, e.message);
    }
  }

  return res.status(200).json({ updated: true, status: newStatus });
}
