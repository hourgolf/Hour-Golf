// Platform-level branding editor for any tenant.
//
// Mirrors /api/admin-tenant-branding but:
//   * Auth is verifyPlatformAdmin (super-admin), not verifyAdmin.
//   * Tenant is chosen by explicit `tenant_id` query param (GET) or
//     body field (PATCH) — NOT resolved from the request's subdomain.
//     This is what makes platform-wide editing work: super-admins on
//     hourgolf.ourlee.co can edit partsdept's branding, etc.
//
// Validation + column allow-list + cache invalidation logic is kept
// identical to admin-tenant-branding so the two endpoints stay in
// sync behaviorally.

import { verifyPlatformAdmin } from "../../lib/platform-auth";
import { SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";
import { invalidateBranding } from "../../lib/branding";

const EDITABLE_COLUMNS = [
  "primary_color",
  "accent_color",
  "danger_color",
  "cream_color",
  "text_color",
  "pwa_theme_color",
  "logo_url",
  "welcome_logo_url",
  "header_logo_url",
  "icon_url",
  "pwa_icon_url",
  "show_welcome_logo",
  "show_welcome_title",
  "show_header_logo",
  "show_header_title",
  "show_icon",
  "welcome_logo_size",
  "header_logo_size",
  "icon_size",
  "legal_url",
  "terms_url",
  "support_email",
  "support_phone",
  "facility_hours",
  "backup_access_code",
  "background_image_url",
  "font_display_name",
  "font_display_url",
  "font_body_family",
  "welcome_message",
  // Multi-tenant readiness fields (migration 20260419000000).
  "cancel_cutoff_hours",
  "bays",
  "bay_label_singular",
  "facility_address",
  "tier_colors",
];

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isValidHex(value) {
  if (typeof value !== "string") return false;
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value);
}

function isValidUrl(value) {
  if (value === null || value === "") return true;
  if (typeof value !== "string") return false;
  if (value.length > 2000) return false;
  return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/");
}

export default async function handler(req, res) {
  const { user, reason } = await verifyPlatformAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  // tenant_id comes from query param on GET, body on PATCH.
  const tenantId = req.method === "GET" ? req.query.tenant_id : req.body?.tenant_id;
  if (!isUuid(tenantId)) {
    return res.status(400).json({ error: "tenant_id must be a valid uuid" });
  }

  try {
    if (req.method === "GET") {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/tenant_branding?tenant_id=eq.${tenantId}&select=*`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      if (!r.ok) throw new Error(`Lookup failed: ${r.status}`);
      const rows = await r.json();
      if (!rows.length) return res.status(404).json({ error: "Branding row not found for tenant" });
      return res.status(200).json(rows[0]);
    }

    if (req.method === "PATCH") {
      const incoming = req.body || {};
      const update = {};

      for (const col of EDITABLE_COLUMNS) {
        if (!(col in incoming)) continue;
        const value = incoming[col];

        if (col.endsWith("_color")) {
          if (value !== null && value !== "" && !isValidHex(value)) {
            return res.status(400).json({ error: `Invalid hex color for ${col}: ${value}` });
          }
        } else if (col.endsWith("_url")) {
          if (!isValidUrl(value)) {
            return res.status(400).json({ error: `Invalid URL for ${col}` });
          }
        } else if (col.startsWith("show_")) {
          if (value !== null && typeof value !== "boolean") {
            return res.status(400).json({ error: `${col} must be boolean` });
          }
        } else if (col.endsWith("_size")) {
          if (value !== null && !["s", "m", "l"].includes(value)) {
            return res.status(400).json({ error: `${col} must be 's', 'm', or 'l'` });
          }
        } else if (col.startsWith("font_")) {
          if (value !== null && typeof value !== "string") {
            return res.status(400).json({ error: `Invalid string for ${col}` });
          }
          if (typeof value === "string" && value.length > 100) {
            return res.status(400).json({ error: `${col} too long` });
          }
        } else if (col === "welcome_message") {
          if (value !== null && typeof value !== "string") {
            return res.status(400).json({ error: `Invalid string for ${col}` });
          }
          if (typeof value === "string" && value.length > 200) {
            return res.status(400).json({ error: `${col} too long (max 200 chars)` });
          }
        } else if (["support_email", "support_phone", "facility_hours", "backup_access_code"].includes(col)) {
          if (value !== null && typeof value !== "string") {
            return res.status(400).json({ error: `Invalid string for ${col}` });
          }
          const max =
            col === "facility_hours" ? 500
            : col === "backup_access_code" ? 20
            : 120;
          if (typeof value === "string" && value.length > max) {
            return res.status(400).json({ error: `${col} too long (max ${max} chars)` });
          }
        } else if (col === "cancel_cutoff_hours") {
          if (value === null) { /* allowed */ }
          else if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 168) {
            return res.status(400).json({ error: `${col} must be a number between 0 and 168` });
          }
        } else if (col === "bays") {
          if (value === null) { /* allowed */ }
          else if (!Array.isArray(value)) {
            return res.status(400).json({ error: `${col} must be an array` });
          } else {
            if (value.length > 20) return res.status(400).json({ error: `${col} too many entries (max 20)` });
            for (const b of value) {
              if (typeof b !== "string" || b.length === 0 || b.length > 30) {
                return res.status(400).json({ error: `${col} entries must be non-empty strings up to 30 chars` });
              }
            }
          }
        } else if (col === "bay_label_singular") {
          if (value === null) { /* allowed */ }
          else if (typeof value !== "string" || value.length === 0 || value.length > 30) {
            return res.status(400).json({ error: `${col} must be a non-empty string up to 30 chars` });
          }
        } else if (col === "facility_address") {
          if (value === null) { /* allowed */ }
          else if (typeof value !== "string" || value.length > 300) {
            return res.status(400).json({ error: `${col} must be a string up to 300 chars` });
          }
        } else if (col === "tier_colors") {
          if (value === null) { /* allowed */ }
          else if (typeof value !== "object" || Array.isArray(value)) {
            return res.status(400).json({ error: `${col} must be an object` });
          } else {
            const keys = Object.keys(value);
            if (keys.length > 20) return res.status(400).json({ error: `${col} too many tiers (max 20)` });
            for (const tier of keys) {
              if (typeof tier !== "string" || tier.length === 0 || tier.length > 50) {
                return res.status(400).json({ error: `${col} tier names must be non-empty strings up to 50 chars` });
              }
              const entry = value[tier];
              if (!entry || typeof entry !== "object") {
                return res.status(400).json({ error: `${col}.${tier} must be an object with bg + text` });
              }
              for (const k of ["bg", "text"]) {
                if (!isValidHex(entry[k])) {
                  return res.status(400).json({ error: `${col}.${tier}.${k} must be a valid hex color` });
                }
              }
            }
          }
        }

        update[col] = value === "" ? null : value;
      }

      if (!Object.keys(update).length) {
        return res.status(400).json({ error: "No editable fields provided" });
      }
      update.updated_at = new Date().toISOString();

      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/tenant_branding?tenant_id=eq.${tenantId}`,
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
      if (!r.ok) {
        const text = await r.text();
        return res.status(500).json({ error: "Update failed", detail: text });
      }
      const rows = await r.json();

      // Flush the in-memory branding cache for this tenant so the edit
      // shows up on the next page render instead of waiting up to 60s.
      invalidateBranding(tenantId);

      return res.status(200).json(rows[0] || null);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("platform-tenant-branding error:", e);
    return res.status(500).json({ error: e.message });
  }
}
