// DELETE /api/platform-tenant-delete?tenant_id=<uuid>
// Hard-delete a tenant and its companion rows. Only succeeds when the
// tenant has NO referencing data (members, bookings, payments, etc.) —
// otherwise returns 409 with per-table counts so the super-admin can
// see why it refused.
//
// Why it's safe to allow:
//   * branding / features / stripe_config FKs to tenants are ON DELETE
//     CASCADE, so they drop automatically when the tenants row goes.
//   * Every other tenant_id FK is ON DELETE NO ACTION. Postgres raises
//     a foreign key violation if any referencing row exists, which is
//     exactly the safety we want — you can't accidentally nuke a live
//     tenant's data.
//
// Pre-flight counts intentionally use EXPLAIN-free count queries so
// the API returns fast even on large tables. We only count the first
// ~20 tables to keep the round-trip bounded; those cover every known
// tenant_id table in the schema today.
//
// Guardrail: the tenant MUST be in status='suspended' before we allow
// delete. That forces a two-step flow (suspend → pause → delete) and
// gives the super-admin a chance to change their mind.

import { verifyPlatformAdmin } from "../../lib/platform-auth";
import { SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";

// Every table that holds tenant_id and DOES NOT cascade from tenants.
// If you add a new tenant_id table, add it here so this endpoint can
// surface a meaningful "N rows blocking delete" message instead of
// failing with an opaque FK violation.
const DATA_TABLES = [
  "members",
  "bookings",
  "payments",
  "shop_items",
  "shop_orders",
  "shop_cart",
  "shop_credits",
  "events",
  "event_interests",
  "event_registrations",
  "event_comments",
  "event_popup_dismissals",
  "loyalty_rules",
  "loyalty_ledger",
  "member_preferences",
  "email_config",
  "email_logs",
  "access_code_jobs",
  "tier_config",
  "admins",
];

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function countRows(key, table, tenantId) {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?tenant_id=eq.${tenantId}&select=tenant_id`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: "count=exact",
        Range: "0-0",
      },
    }
  );
  if (!resp.ok) return { ok: false, status: resp.status };
  const range = resp.headers.get("content-range") || "";
  const match = range.match(/\/(\d+|\*)$/);
  const count = match ? (match[1] === "*" ? 0 : parseInt(match[1], 10)) : 0;
  return { ok: true, count };
}

export default async function handler(req, res) {
  if (req.method !== "DELETE") return res.status(405).json({ error: "DELETE only" });

  const { user, reason } = await verifyPlatformAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const tenantId = String(req.query.tenant_id || "");
  if (!isUuid(tenantId)) {
    return res.status(400).json({ error: "tenant_id must be a valid uuid" });
  }

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  try {
    // 1. Tenant must exist and be in status=suspended.
    const tResp = await fetch(
      `${SUPABASE_URL}/rest/v1/tenants?id=eq.${tenantId}&select=id,slug,name,status`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!tResp.ok) throw new Error(`tenant lookup ${tResp.status}`);
    const tRows = await tResp.json();
    if (!tRows.length) return res.status(404).json({ error: "Tenant not found" });
    const tenant = tRows[0];

    if (tenant.status !== "suspended") {
      return res.status(409).json({
        error: "must_be_suspended",
        detail:
          "Tenant must be suspended before deletion. Suspend first, verify no regression, then retry delete.",
        current_status: tenant.status,
      });
    }

    // 2. Count rows in every data table. Any non-zero blocks the delete.
    const counts = {};
    let blocked = false;
    await Promise.all(
      DATA_TABLES.map(async (table) => {
        const r = await countRows(key, table, tenantId);
        if (!r.ok) {
          counts[table] = { error: r.status };
        } else {
          counts[table] = r.count;
          if (r.count > 0) blocked = true;
        }
      })
    );

    if (blocked) {
      return res.status(409).json({
        error: "tenant_has_data",
        detail:
          "Tenant still has data in one or more tables. Remove the data manually in Supabase or keep the tenant suspended.",
        counts,
      });
    }

    // 3. Delete the tenants row. FK CASCADE removes tenant_branding,
    // tenant_features, and tenant_stripe_config automatically.
    const delResp = await fetch(
      `${SUPABASE_URL}/rest/v1/tenants?id=eq.${tenantId}`,
      {
        method: "DELETE",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Prefer: "return=representation",
        },
      }
    );
    if (!delResp.ok) {
      const body = await delResp.text();
      // A surprise FK violation here means we missed a table in
      // DATA_TABLES — surface the error so we can add it.
      if (delResp.status === 409) {
        return res.status(409).json({
          error: "fk_violation",
          detail: `Delete failed with FK violation — a table with tenant_id rows wasn't caught by pre-flight counts. Add the table to DATA_TABLES. Raw: ${body}`,
        });
      }
      return res.status(500).json({ error: "Delete failed", detail: body });
    }

    return res.status(200).json({
      deleted: true,
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
    });
  } catch (e) {
    console.error("platform-tenant-delete error:", e);
    return res.status(500).json({ error: "Delete failed", detail: e.message });
  }
}
