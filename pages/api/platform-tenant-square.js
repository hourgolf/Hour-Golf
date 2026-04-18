// PATCH/GET /api/platform-tenant-square
// Upsert a tenant's Square POS config. Mirrors /api/platform-tenant-seam:
// same write-only secret handling, masked summary response, cache
// invalidation.
//
// Body (all optional except tenant_id; only present fields are applied):
//   tenant_id              REQUIRED uuid
//   environment            'sandbox' | 'production'
//   access_token           non-empty string (empty/missing = keep existing)
//   location_id            non-empty string
//   application_id         non-empty string | null
//   webhook_signature_key  non-empty string (empty/missing = keep existing)
//   enabled                boolean kill-switch

import { verifyPlatformAdmin } from "../../lib/platform-auth";
import { SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";
import { invalidateSquareConfig } from "../../lib/square-config";

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function maskSecret(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return {
    length: trimmed.length,
    last4: trimmed.slice(-4),
    prefix: trimmed.slice(0, Math.min(7, trimmed.length)),
  };
}

export default async function handler(req, res) {
  const { user, reason } = await verifyPlatformAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  if (req.method === "GET") {
    const tenantId = String(req.query.tenant_id || "");
    if (!isUuid(tenantId)) return res.status(400).json({ error: "tenant_id must be a valid uuid" });
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_square_config?tenant_id=eq.${tenantId}&select=*`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!r.ok) return res.status(500).json({ error: "lookup failed" });
    const rows = await r.json();
    const row = rows[0] || null;
    if (!row) return res.status(200).json(null);
    return res.status(200).json({
      enabled: !!row.enabled,
      environment: row.environment || "production",
      access_token: maskSecret(row.access_token),
      location_id: row.location_id || null,
      application_id: row.application_id || null,
      webhook_signature_key: maskSecret(row.webhook_signature_key),
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
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

  if ("environment" in body) {
    if (body.environment !== "sandbox" && body.environment !== "production") {
      return res.status(400).json({ error: "environment must be 'sandbox' or 'production'" });
    }
    update.environment = body.environment;
  }

  if ("access_token" in body) {
    const v = body.access_token;
    if (typeof v === "string" && v.trim().length > 0) {
      const t = v.trim();
      if (t.length < 10 || t.length > 1000) {
        return res.status(400).json({ error: "access_token length out of range" });
      }
      update.access_token = t;
    }
    // Empty/missing → keep existing.
  }

  if ("location_id" in body) {
    const v = body.location_id;
    if (typeof v === "string" && v.trim().length > 0) {
      const t = v.trim();
      if (t.length < 3 || t.length > 200) {
        return res.status(400).json({ error: "location_id length out of range" });
      }
      update.location_id = t;
    }
  }

  if ("application_id" in body) {
    const v = body.application_id;
    if (v === null || v === "") {
      update.application_id = null;
    } else if (typeof v === "string" && v.trim().length > 0) {
      const t = v.trim();
      if (t.length < 3 || t.length > 200) {
        return res.status(400).json({ error: "application_id length out of range" });
      }
      update.application_id = t;
    }
  }

  if ("webhook_signature_key" in body) {
    const v = body.webhook_signature_key;
    if (typeof v === "string" && v.trim().length > 0) {
      const t = v.trim();
      if (t.length < 10 || t.length > 500) {
        return res.status(400).json({ error: "webhook_signature_key length out of range" });
      }
      update.webhook_signature_key = t;
    }
    // Empty/missing → keep existing.
  }

  if (Object.keys(update).length === 0) {
    return res.status(400).json({ error: "No fields to update" });
  }
  update.updated_at = new Date().toISOString();

  try {
    const existingResp = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_square_config?tenant_id=eq.${tenantId}&select=tenant_id`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!existingResp.ok) throw new Error(`existing check ${existingResp.status}`);
    const existing = await existingResp.json();

    let saved;
    if (existing.length > 0) {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/tenant_square_config?tenant_id=eq.${tenantId}`,
        {
          method: "PATCH",
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: JSON.stringify(update),
        }
      );
      if (!r.ok) throw new Error(`update ${r.status} ${await r.text()}`);
      const rows = await r.json();
      saved = rows[0];
    } else {
      if (!update.access_token || !update.location_id) {
        return res.status(400).json({
          error: "access_token and location_id are both required when creating a new Square config row",
        });
      }
      if (!("enabled" in update)) update.enabled = false;
      if (!("environment" in update)) update.environment = "production";
      update.tenant_id = tenantId;
      const r = await fetch(`${SUPABASE_URL}/rest/v1/tenant_square_config`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(update),
      });
      if (!r.ok) throw new Error(`insert ${r.status} ${await r.text()}`);
      const rows = await r.json();
      saved = rows[0];
    }

    invalidateSquareConfig(tenantId);

    return res.status(200).json({
      enabled: !!saved.enabled,
      environment: saved.environment || "production",
      access_token: maskSecret(saved.access_token),
      location_id: saved.location_id || null,
      application_id: saved.application_id || null,
      webhook_signature_key: maskSecret(saved.webhook_signature_key),
      created_at: saved.created_at,
      updated_at: saved.updated_at,
    });
  } catch (e) {
    console.error("platform-tenant-square error:", e);
    return res.status(500).json({ error: "Update failed", detail: e.message });
  }
}
