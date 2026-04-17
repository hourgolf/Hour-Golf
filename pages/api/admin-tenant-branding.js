// Admin endpoint for reading and updating the current tenant's branding row.
// GET  — return the full tenant_branding row
// PATCH — partial update of color/logo/font fields
//
// verifyAdmin() already enforces tenant isolation: the authenticated admin
// can only operate on their own tenant (the one resolved from the request
// subdomain). No additional tenant checks needed here.
//
// On successful PATCH we invalidate the server-side branding cache so the
// admin sees their edit on the next page load instead of waiting 60s.

import { verifyAdmin, getServiceKey, SUPABASE_URL } from "../../lib/api-helpers";
import { invalidateBranding } from "../../lib/branding";

// Columns the admin is allowed to edit. Other columns on tenant_branding
// (tenant_id, updated_at) are managed by the system.
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
  "show_welcome_logo",
  "show_welcome_title",
  "show_header_logo",
  "show_header_title",
  "show_icon",
  "welcome_logo_size",
  "header_logo_size",
  "icon_size",
  "background_image_url",
  "font_display_name",
  "font_display_url",
  "font_body_family",
  "welcome_message",
];

// Accept #RGB, #RRGGBB, #RRGGBBAA forms. Reject anything else to keep bad
// input from landing in CSS.
function isValidHex(value) {
  if (typeof value !== "string") return false;
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value);
}

// URL validation is intentionally permissive — absolute URLs (uploaded
// logos/fonts come back as https://...) and root-relative paths (existing
// seeded values like /blobs/... and /fonts/...) are both accepted.
function isValidUrl(value) {
  if (value === null || value === "") return true; // explicit clear
  if (typeof value !== "string") return false;
  if (value.length > 2000) return false;
  return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/");
}

export default async function handler(req, res) {
  const { user, tenantId, reason } = await verifyAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  try {
    if (req.method === "GET") {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/tenant_branding?tenant_id=eq.${tenantId}&select=*`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      if (!r.ok) throw new Error(`Lookup failed: ${r.status}`);
      const rows = await r.json();
      if (!rows.length) {
        // Should never happen — every tenant gets a row at creation. Return
        // 404 so the UI can show a meaningful message if it ever does.
        return res.status(404).json({ error: "Branding row not found for tenant" });
      }
      return res.status(200).json(rows[0]);
    }

    if (req.method === "PATCH") {
      const incoming = req.body || {};
      const update = {};

      for (const col of EDITABLE_COLUMNS) {
        if (!(col in incoming)) continue; // not being updated this call
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
        }

        // Normalize empty string to null so the DB stores a clean absence.
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

      // Flush the in-memory branding cache so the next page render reads
      // the fresh values instead of showing the admin their old branding
      // for up to 60 seconds.
      invalidateBranding(tenantId);

      return res.status(200).json(rows[0] || null);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("admin-tenant-branding error:", e);
    return res.status(500).json({ error: e.message });
  }
}
