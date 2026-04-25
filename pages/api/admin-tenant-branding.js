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
import { logActivity } from "../../lib/activity-log";
import { validateAllOverrides } from "../../lib/email-overrides";

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
  // Multi-tenant readiness fields (migration 20260419000000). The
  // admin Settings → Operations panel writes these.
  "cancel_cutoff_hours",
  "bays",
  "bay_label_singular",
  "facility_address",
  "tier_colors",
  "max_daily_hours_per_member",
  "dashboard_empty_headline",
  // Editable Help Center FAQ tree. NULL means "use the platform default
  // shape from lib/help-faqs.js"; an array overrides it.
  "help_faqs",
  // Per-template email copy overrides. NULL = use platform defaults
  // baked into lib/email.js. Shape validated below via
  // validateAllOverrides from lib/email-overrides.js.
  "email_overrides",
];

// Bounds for help_faqs validation. Generous enough to cover any real
// admin's editing needs without letting a runaway client blow up the
// member-facing drawer with multi-megabyte payloads.
const HELP_FAQS_LIMITS = {
  maxCategories: 12,
  maxItemsPerCategory: 30,
  maxLabelLen: 60,
  maxIconLen: 8,        // an emoji or two, not an essay
  maxQuestionLen: 250,
  maxAnswerLen: 4000,
};

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
          // Numeric, non-negative, <= 168 (one week). null = use the
          // platform default (DEFAULT_CANCEL_CUTOFF_HOURS in lib/branding).
          if (value === null) { /* allowed */ }
          else if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 168) {
            return res.status(400).json({ error: `${col} must be a number between 0 and 168` });
          }
        } else if (col === "max_daily_hours_per_member") {
          // Numeric, non-negative, <= 24h/day. null = no cap (members
          // can extend up to whatever the bay availability + tier
          // booking_hours_end allows).
          if (value === null) { /* allowed */ }
          else if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 24) {
            return res.status(400).json({ error: `${col} must be a number between 0 and 24` });
          }
        } else if (col === "dashboard_empty_headline") {
          if (value === null) { /* allowed */ }
          else if (typeof value !== "string" || value.length > 80) {
            return res.status(400).json({ error: `${col} must be a string up to 80 chars` });
          }
        } else if (col === "bays") {
          // Array of non-empty strings. Cap each name at 30 chars and the
          // list at 20 entries to prevent UI explosions.
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
        } else if (col === "email_overrides") {
          // Validate via the shared helper which knows the template
          // catalog and per-field length limits.
          const err = validateAllOverrides(value);
          if (err) return res.status(400).json({ error: err });
        } else if (col === "help_faqs") {
          // Array of category objects, or null to revert to platform
          // defaults. Each category needs a non-empty label and an
          // items array; each item needs a non-empty question. The
          // troubleshoot + requires flags are passthrough booleans/
          // strings so the access-code troubleshooting entry survives
          // a round-trip through the editor.
          if (value === null) { /* allowed — clears to defaults */ }
          else if (!Array.isArray(value)) {
            return res.status(400).json({ error: `${col} must be an array or null` });
          } else {
            if (value.length > HELP_FAQS_LIMITS.maxCategories) {
              return res.status(400).json({ error: `${col} too many categories (max ${HELP_FAQS_LIMITS.maxCategories})` });
            }
            for (const cat of value) {
              if (!cat || typeof cat !== "object") {
                return res.status(400).json({ error: `${col} categories must be objects` });
              }
              if (typeof cat.label !== "string" || cat.label.trim().length === 0 || cat.label.length > HELP_FAQS_LIMITS.maxLabelLen) {
                return res.status(400).json({ error: `${col} category label must be a non-empty string up to ${HELP_FAQS_LIMITS.maxLabelLen} chars` });
              }
              if (cat.icon != null && (typeof cat.icon !== "string" || cat.icon.length > HELP_FAQS_LIMITS.maxIconLen)) {
                return res.status(400).json({ error: `${col} category icon must be a string up to ${HELP_FAQS_LIMITS.maxIconLen} chars` });
              }
              if (!Array.isArray(cat.items)) {
                return res.status(400).json({ error: `${col} category items must be an array` });
              }
              if (cat.items.length > HELP_FAQS_LIMITS.maxItemsPerCategory) {
                return res.status(400).json({ error: `${col} too many items in category (max ${HELP_FAQS_LIMITS.maxItemsPerCategory})` });
              }
              for (const it of cat.items) {
                if (!it || typeof it !== "object") {
                  return res.status(400).json({ error: `${col} items must be objects` });
                }
                if (typeof it.q !== "string" || it.q.trim().length === 0 || it.q.length > HELP_FAQS_LIMITS.maxQuestionLen) {
                  return res.status(400).json({ error: `${col} question must be a non-empty string up to ${HELP_FAQS_LIMITS.maxQuestionLen} chars` });
                }
                if (it.a != null && (typeof it.a !== "string" || it.a.length > HELP_FAQS_LIMITS.maxAnswerLen)) {
                  return res.status(400).json({ error: `${col} answer must be a string up to ${HELP_FAQS_LIMITS.maxAnswerLen} chars` });
                }
                if (it.troubleshoot != null && typeof it.troubleshoot !== "boolean") {
                  return res.status(400).json({ error: `${col} item.troubleshoot must be boolean` });
                }
                if (it.requires != null && typeof it.requires !== "string") {
                  return res.status(400).json({ error: `${col} item.requires must be a string` });
                }
              }
            }
          }
        } else if (col === "tier_colors") {
          // Object map { TierName: { bg: "#hex", text: "#hex" } }. Cap at
          // 20 tiers; each entry's bg + text must be valid hex.
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

      await logActivity({
        tenantId,
        actor: { id: user.id, email: user.email },
        action: "settings.workspace_updated",
        targetType: "settings",
        targetId: "tenant_branding",
        metadata: {
          fields_changed: Object.keys(update).filter((k) => k !== "updated_at"),
        },
      });

      return res.status(200).json(rows[0] || null);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("admin-tenant-branding error:", e);
    return res.status(500).json({ error: e.message });
  }
}
