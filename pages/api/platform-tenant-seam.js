// PATCH /api/platform-tenant-seam
// Upsert a tenant's Seam (smart-lock) config. Mirrors
// /api/platform-tenant-stripe — same write-only secret handling, same
// masked summary response, same cache invalidation pattern.
//
// Body fields (all optional — only present fields are applied):
//   tenant_id  (REQUIRED)  uuid
//   api_key                non-empty string (empty/missing = keep existing)
//   device_id              non-empty string
//   enabled                boolean kill-switch

import { verifyPlatformAdmin } from "../../lib/platform-auth";
import { SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";
import { invalidateSeamConfig } from "../../lib/seam-config";

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
      `${SUPABASE_URL}/rest/v1/tenant_seam_config?tenant_id=eq.${tenantId}&select=*`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!r.ok) return res.status(500).json({ error: "lookup failed" });
    const rows = await r.json();
    const row = rows[0] || null;
    if (!row) return res.status(200).json(null);
    return res.status(200).json({
      enabled: !!row.enabled,
      api_key: maskSecret(row.api_key),
      device_id: row.device_id || null,
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

  if ("api_key" in body) {
    const v = body.api_key;
    if (typeof v === "string" && v.trim().length > 0) {
      const t = v.trim();
      if (t.length < 10 || t.length > 500) {
        return res.status(400).json({ error: "api_key length out of range" });
      }
      update.api_key = t;
    }
    // Empty/missing → leave existing key in place (never clears).
  }

  if ("device_id" in body) {
    const v = body.device_id;
    if (typeof v === "string" && v.trim().length > 0) {
      const t = v.trim();
      if (t.length < 3 || t.length > 200) {
        return res.status(400).json({ error: "device_id length out of range" });
      }
      update.device_id = t;
    }
    // Empty/missing → keep existing.
  }

  if (Object.keys(update).length === 0) {
    return res.status(400).json({ error: "No fields to update" });
  }
  update.updated_at = new Date().toISOString();

  try {
    const existingResp = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_seam_config?tenant_id=eq.${tenantId}&select=tenant_id`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!existingResp.ok) throw new Error(`existing check ${existingResp.status}`);
    const existing = await existingResp.json();

    let saved;
    if (existing.length > 0) {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/tenant_seam_config?tenant_id=eq.${tenantId}`,
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
      if (!update.api_key || !update.device_id) {
        return res.status(400).json({
          error: "api_key and device_id are both required when creating a new Seam config row",
        });
      }
      if (!("enabled" in update)) update.enabled = false;
      update.tenant_id = tenantId;
      const r = await fetch(`${SUPABASE_URL}/rest/v1/tenant_seam_config`, {
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

    invalidateSeamConfig(tenantId);

    return res.status(200).json({
      enabled: !!saved.enabled,
      api_key: maskSecret(saved.api_key),
      device_id: saved.device_id || null,
      created_at: saved.created_at,
      updated_at: saved.updated_at,
    });
  } catch (e) {
    console.error("platform-tenant-seam error:", e);
    return res.status(500).json({ error: "Update failed", detail: e.message });
  }
}
