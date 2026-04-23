// Admin-only audit trail of "who did what when".
//
// Callers SHOULD await logActivity() — Vercel's serverless runtime
// terminates pending promises once the handler returns, so an
// un-awaited log can silently drop. logActivity never throws (all
// errors are caught and surfaced to stderr), so awaiting costs a bit
// of latency but never fails the caller's request.
//
// Writes use the service role (bypasses RLS). Reads go through the
// authenticated role + admin_all policy on admin_activity_log.
//
// The pure payload builder is exported so tests don't need network.

import { SUPABASE_URL, getServiceKey } from "./api-helpers";

const MAX_METADATA_KEYS = 20;
const MAX_STRING_LENGTH = 500;
const MAX_ACTION_LENGTH = 100;
const MAX_TARGET_TYPE_LENGTH = 50;

export function buildActivityPayload({
  tenantId,
  actor,
  action,
  targetType = null,
  targetId = null,
  metadata = null,
} = {}) {
  if (!tenantId || typeof tenantId !== "string") return null;
  if (!action || typeof action !== "string") return null;

  return {
    tenant_id: tenantId,
    actor_user_id: actor?.id || null,
    actor_email: actor?.email
      ? String(actor.email).slice(0, MAX_STRING_LENGTH)
      : null,
    action: action.slice(0, MAX_ACTION_LENGTH),
    target_type: targetType
      ? String(targetType).slice(0, MAX_TARGET_TYPE_LENGTH)
      : null,
    target_id: targetId == null ? null : String(targetId).slice(0, MAX_STRING_LENGTH),
    metadata: safeMetadata(metadata),
  };
}

function safeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return null;
  const entries = Object.entries(metadata).slice(0, MAX_METADATA_KEYS);
  const out = {};
  for (const [k, v] of entries) {
    if (v === null || v === undefined) out[k] = null;
    else if (typeof v === "string") out[k] = v.slice(0, MAX_STRING_LENGTH);
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else {
      try {
        out[k] = JSON.parse(JSON.stringify(v));
      } catch {
        out[k] = null;
      }
    }
  }
  return out;
}

export async function logActivity(input) {
  const payload = buildActivityPayload(input);
  if (!payload) return;
  const key = getServiceKey();
  if (!key) return;
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/admin_activity_log`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.error(
        `[activity-log] insert failed ${resp.status}: ${text.slice(0, 200)}`
      );
    }
  } catch (e) {
    console.error(`[activity-log] insert exception: ${e?.message || e}`);
  }
}
