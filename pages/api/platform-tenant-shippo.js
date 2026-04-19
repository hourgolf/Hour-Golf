// PATCH/GET /api/platform-tenant-shippo
// Upsert a tenant's Shippo (shipping carrier API) config. Mirrors
// /api/platform-tenant-stripe / /api/platform-tenant-seam /
// /api/platform-tenant-square: same write-only secret pattern,
// masked summary response, cache invalidation.

import crypto from "crypto";
import { verifyPlatformAdmin } from "../../lib/platform-auth";
import { SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";
import { invalidateShippoConfig } from "../../lib/shippo-config";

function isUuid(v) {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function maskSecret(value) {
  if (!value || typeof value !== "string") return null;
  const t = value.trim();
  if (!t) return null;
  return { length: t.length, last4: t.slice(-4), prefix: t.slice(0, Math.min(7, t.length)) };
}

function publicProjection(row) {
  if (!row) return null;
  return {
    enabled: !!row.enabled,
    api_key: maskSecret(row.api_key),
    // Webhook token is shown in plaintext — it's the URL secret, not
    // a signing key, and the admin needs the full string to paste into
    // Shippo's webhook URL.
    tracking_webhook_secret: row.tracking_webhook_secret || null,
    origin_name: row.origin_name || "",
    origin_company: row.origin_company || "",
    origin_street1: row.origin_street1 || "",
    origin_street2: row.origin_street2 || "",
    origin_city: row.origin_city || "",
    origin_state: row.origin_state || "",
    origin_zip: row.origin_zip || "",
    origin_country: row.origin_country || "US",
    origin_phone: row.origin_phone || "",
    origin_email: row.origin_email || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const ADDRESS_FIELDS = [
  "origin_name", "origin_company",
  "origin_street1", "origin_street2",
  "origin_city", "origin_state", "origin_zip",
  "origin_country", "origin_phone", "origin_email",
];

export default async function handler(req, res) {
  const { user, reason } = await verifyPlatformAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  if (req.method === "GET") {
    const tenantId = String(req.query.tenant_id || "");
    if (!isUuid(tenantId)) return res.status(400).json({ error: "tenant_id must be a valid uuid" });
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_shippo_config?tenant_id=eq.${tenantId}&select=*`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!r.ok) return res.status(500).json({ error: "lookup failed" });
    const rows = await r.json();
    return res.status(200).json(publicProjection(rows[0] || null));
  }

  if (req.method !== "PATCH") return res.status(405).json({ error: "GET or PATCH only" });

  const body = req.body || {};
  const tenantId = body.tenant_id;
  if (!isUuid(tenantId)) return res.status(400).json({ error: "tenant_id must be a valid uuid" });

  const update = {};

  if ("enabled" in body) {
    if (typeof body.enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be boolean" });
    }
    update.enabled = body.enabled;
  }

  if ("api_key" in body) {
    const v = body.api_key;
    if (typeof v === "string" && v.trim().length > 0) {
      const t = v.trim();
      if (t.length < 10 || t.length > 1000) {
        return res.status(400).json({ error: "api_key length out of range" });
      }
      update.api_key = t;
    }
    // Empty/missing -> keep existing.
  }

  if ("tracking_webhook_secret" in body) {
    const v = body.tracking_webhook_secret;
    if (typeof v === "string" && v.trim().length > 0) {
      const t = v.trim();
      if (t.length < 10 || t.length > 500) {
        return res.status(400).json({ error: "tracking_webhook_secret length out of range" });
      }
      update.tracking_webhook_secret = t;
    }
    // Empty/missing -> keep existing.
  }

  // Convenience: server-side token generator. Admin clicks "Generate
  // webhook URL" in the Shippo tab and we mint a 32-byte hex token,
  // skipping the "what should I paste?" friction. Replaces any
  // existing token; admin must update Shippo's subscription URL too.
  if (body.regenerate_webhook_token === true) {
    update.tracking_webhook_secret = crypto.randomBytes(32).toString("hex");
  }

  for (const f of ADDRESS_FIELDS) {
    if (f in body) {
      const v = body[f];
      if (v === null || v === "") {
        update[f] = null;
      } else if (typeof v === "string") {
        const t = v.trim();
        if (t.length > 200) {
          return res.status(400).json({ error: `${f} too long` });
        }
        update[f] = t;
      }
    }
  }

  if (Object.keys(update).length === 0) {
    return res.status(400).json({ error: "No fields to update" });
  }
  update.updated_at = new Date().toISOString();

  try {
    const existingResp = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_shippo_config?tenant_id=eq.${tenantId}&select=tenant_id`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!existingResp.ok) throw new Error(`existing check ${existingResp.status}`);
    const existing = await existingResp.json();

    let saved;
    if (existing.length > 0) {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/tenant_shippo_config?tenant_id=eq.${tenantId}`,
        {
          method: "PATCH",
          headers: {
            apikey: key, Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: JSON.stringify(update),
        }
      );
      if (!r.ok) throw new Error(`update ${r.status} ${await r.text()}`);
      saved = (await r.json())[0];
    } else {
      // INSERT path: api_key + minimal address are required (NOT NULL on DB).
      const requiredOnInsert = ["api_key", "origin_street1", "origin_city", "origin_state", "origin_zip"];
      for (const f of requiredOnInsert) {
        if (!update[f]) {
          return res.status(400).json({
            error: `${f} is required when creating a new Shippo config row`,
          });
        }
      }
      if (!("enabled" in update)) update.enabled = false;
      if (!("origin_country" in update)) update.origin_country = "US";
      update.tenant_id = tenantId;
      const r = await fetch(`${SUPABASE_URL}/rest/v1/tenant_shippo_config`, {
        method: "POST",
        headers: {
          apikey: key, Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(update),
      });
      if (!r.ok) throw new Error(`insert ${r.status} ${await r.text()}`);
      saved = (await r.json())[0];
    }

    invalidateShippoConfig(tenantId);
    return res.status(200).json(publicProjection(saved));
  } catch (e) {
    console.error("platform-tenant-shippo error:", e);
    return res.status(500).json({ error: "Update failed", detail: e.message });
  }
}
