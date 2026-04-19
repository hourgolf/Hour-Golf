// /api/shippo-webhook?token=<tenant_token>
//
// Receives tracking status updates from Shippo. Registered at the
// Shippo Dashboard → Webhooks (event: track_updated). Shippo doesn't
// HMAC-sign webhooks — their recommended pattern is a hard-to-guess
// URL, so we use a per-tenant token in the query string. The token
// lives in tenant_shippo_config.tracking_webhook_secret and is
// generated server-side by the platform admin UI ("Generate webhook
// URL" button).
//
// Auth model:
//   1. Read ?token=<...> from the URL.
//   2. Look up the tenant whose tracking_webhook_secret matches
//      (service-role bypasses RLS for this lookup).
//   3. If no match → 401.
//   4. Otherwise, parse + dispatch the tracking update.
// We also validate the tracking_number resolves to a shop_orders row
// in that tenant before writing — defense in depth against a leaked
// token getting used to spam status updates against unrelated orders.

import { SUPABASE_URL, getServiceKey, getRequestOrigin } from "../../lib/api-helpers";
import { sendShipmentDeliveredEmail } from "../../lib/email";

// We don't sign-verify so bodyParser default is fine, but explicit
// JSON parsing keeps behavior consistent with other webhooks.
export const config = { api: { bodyParser: true } };

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

  const token = String(req.query.token || "").trim();
  if (!token || token.length < 16) {
    // Don't leak whether tokens are required — opaque 401.
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Resolve tenant by token. PostgREST returns an array; filter is
  // exact-match.
  const cfgResp = await fetch(
    `${SUPABASE_URL}/rest/v1/tenant_shippo_config?tracking_webhook_secret=eq.${encodeURIComponent(token)}&select=tenant_id`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  if (!cfgResp.ok) {
    console.error(`shippo-webhook: tenant lookup ${cfgResp.status}`);
    return res.status(500).json({ error: "Lookup failed" });
  }
  const cfgs = await cfgResp.json();
  if (cfgs.length === 0) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const tenantId = cfgs[0].tenant_id;

  // Shippo's track_updated payload shape:
  //   { event: "track_updated", data: { tracking_number, tracking_status: {...}, ... } }
  // Older shapes deliver fields at the top level. Handle both.
  const body = req.body || {};
  const data = body.data || body;
  const trackingNumber = data?.tracking_number;
  if (!trackingNumber) return res.status(400).json({ error: "Missing tracking_number" });

  const ts = data?.tracking_status || {};
  const statusRaw = ts.status;
  const statusDetail = ts.status_details || "";
  const statusDate = ts.status_date || null;

  // Look up the order, scoped to the resolved tenant. If the token is
  // valid but the tracking number isn't ours, treat it as ignored
  // (200, no retry storm).
  const orderResp = await fetch(
    `${SUPABASE_URL}/rest/v1/shop_orders?tenant_id=eq.${tenantId}&tracking_number=eq.${encodeURIComponent(trackingNumber)}&select=id,member_email,stripe_payment_intent_id,shipping_status,shipping_carrier,shipping_service&limit=1`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  if (!orderResp.ok) {
    console.error(`shippo-webhook: order lookup ${orderResp.status}`);
    return res.status(500).json({ error: "Order lookup failed" });
  }
  const orderRows = await orderResp.json();
  const firstRow = orderRows[0];
  if (!firstRow) {
    console.log(`shippo-webhook: tenant ${tenantId} no order for tracking ${trackingNumber}`);
    return res.status(200).json({ ignored: true });
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

  if (newStatus === "delivered" && prevStatus !== "delivered") {
    try {
      await sendShipmentDeliveredEmail({
        tenantId,
        to: firstRow.member_email,
        trackingNumber,
        carrier: firstRow.shipping_carrier || null,
        service: firstRow.shipping_service || null,
        portalUrl: getRequestOrigin(req),
      });
    } catch (e) {
      console.error(`shippo-webhook: delivered email failed for ${firstRow.member_email}:`, e.message);
    }
  }

  return res.status(200).json({ updated: true, status: newStatus });
}
