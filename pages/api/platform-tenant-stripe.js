// PATCH /api/platform-tenant-stripe
// Update or create a tenant's Stripe config row.
//
// Body fields (all optional — only present fields are applied):
//   tenant_id       (REQUIRED)  uuid
//   mode            "test" | "live"
//   enabled         boolean
//   secret_key      non-empty string  (else field is ignored — never clears
//                                      to null, since enabled=true + empty
//                                      key would brick the tenant)
//   publishable_key string | null
//   webhook_secret  string | null
//
// Secrets are write-only: they land in the DB via this endpoint and are
// read only by server-side code (lib/stripe-config). This endpoint NEVER
// returns a plaintext secret back. Response is the same masked summary
// shape as platform-tenant.js.
//
// Security posture: requires a verified platform admin; service-role key
// writes the row; lib/stripe-config cache is invalidated so Phase 7B
// routes pick up the new values on the next request.

import { verifyPlatformAdmin } from "../../lib/platform-auth";
import { SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";
import { invalidateStripeConfig } from "../../lib/stripe-config";

const VALID_MODES = new Set(["test", "live"]);

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// Reasonable shape guards. Stripe keys are long (sk_live_... ~100 chars,
// whsec_... ~38), so a generous max protects against garbage input
// without being too strict.
function isPlausibleSecret(prefix, value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length < 10 || trimmed.length > 500) return false;
  if (prefix && !trimmed.startsWith(prefix)) return false;
  return true;
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
  if (req.method !== "PATCH") return res.status(405).json({ error: "PATCH only" });

  const { user, reason } = await verifyPlatformAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const body = req.body || {};
  const tenantId = body.tenant_id;
  if (!isUuid(tenantId)) return res.status(400).json({ error: "tenant_id must be a valid uuid" });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  // Build only the fields the caller sent. Missing fields leave DB
  // columns untouched. Empty strings = "user cleared the field" for
  // nullable columns (publishable_key, webhook_secret) only.
  const update = {};

  if ("mode" in body) {
    if (!VALID_MODES.has(body.mode)) {
      return res.status(400).json({ error: "mode must be 'test' or 'live'" });
    }
    update.mode = body.mode;
  }

  if ("enabled" in body) {
    if (typeof body.enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be boolean" });
    }
    update.enabled = body.enabled;
  }

  if ("secret_key" in body) {
    const val = body.secret_key;
    if (typeof val === "string" && val.trim().length > 0) {
      if (!isPlausibleSecret("sk_", val)) {
        return res.status(400).json({ error: "secret_key must start with sk_ and be a plausible Stripe key" });
      }
      update.secret_key = val.trim();
    }
    // Empty string / missing → ignore. We don't clear the secret.
  }

  if ("publishable_key" in body) {
    const val = body.publishable_key;
    if (val === null || val === "") {
      update.publishable_key = null;
    } else if (typeof val === "string" && isPlausibleSecret("pk_", val)) {
      update.publishable_key = val.trim();
    } else {
      return res.status(400).json({ error: "publishable_key must start with pk_ or be null/empty" });
    }
  }

  if ("webhook_secret" in body) {
    const val = body.webhook_secret;
    if (val === null || val === "") {
      update.webhook_secret = null;
    } else if (typeof val === "string" && isPlausibleSecret("whsec_", val)) {
      update.webhook_secret = val.trim();
    } else {
      return res.status(400).json({ error: "webhook_secret must start with whsec_ or be null/empty" });
    }
  }

  if (Object.keys(update).length === 0) {
    return res.status(400).json({ error: "No fields to update" });
  }

  update.updated_at = new Date().toISOString();

  try {
    // Does a row exist yet? If yes PATCH, if no INSERT (first-time setup).
    const existingResp = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_stripe_config?tenant_id=eq.${tenantId}&select=tenant_id`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!existingResp.ok) throw new Error(`existing check failed: ${existingResp.status}`);
    const existing = await existingResp.json();

    let savedRow;
    if (existing.length > 0) {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/tenant_stripe_config?tenant_id=eq.${tenantId}`,
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
      if (!r.ok) throw new Error(`update failed: ${r.status} ${await r.text()}`);
      const rows = await r.json();
      savedRow = rows[0];
    } else {
      // First-time INSERT. Require secret_key + mode to be present so we
      // never write a half-configured row that would throw on
      // getStripeClient.
      if (!update.secret_key) {
        return res.status(400).json({
          error: "secret_key is required when creating a new Stripe config row",
        });
      }
      if (!update.mode) update.mode = "test";
      if (!("enabled" in update)) update.enabled = false; // opt-in; super-admin flips later
      update.tenant_id = tenantId;
      const r = await fetch(`${SUPABASE_URL}/rest/v1/tenant_stripe_config`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(update),
      });
      if (!r.ok) throw new Error(`insert failed: ${r.status} ${await r.text()}`);
      const rows = await r.json();
      savedRow = rows[0];
    }

    invalidateStripeConfig(tenantId);

    return res.status(200).json({
      mode: savedRow.mode,
      enabled: !!savedRow.enabled,
      secret_key: maskSecret(savedRow.secret_key),
      publishable_key: maskSecret(savedRow.publishable_key),
      webhook_secret: maskSecret(savedRow.webhook_secret),
      created_at: savedRow.created_at,
      updated_at: savedRow.updated_at,
    });
  } catch (e) {
    console.error("platform-tenant-stripe error:", e);
    return res.status(500).json({ error: "Update failed", detail: e.message });
  }
}
