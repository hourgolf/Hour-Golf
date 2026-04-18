// Member session helpers (Tier 2).
//
// This module replaces the single-scalar-per-member pattern in members.
// session_token / session_expires_at. A member can hold many concurrent
// sessions, one row per device.
//
// Rollout is staged (two PRs):
//
//   PR 1 (this change): create table + helper, dual-write from member-
//     auth.js. The 19 existing readers still query members.session_token
//     directly and continue to work because we keep updating the scalar
//     to match the most-recent login. getSessionWithMember() falls back
//     to the scalar if a token isn't yet in the new table.
//
//   PR 2 (next session): migrate each reader to getSessionWithMember(),
//     update member-logout.js to delete the specific session row, then
//     drop the scalar columns.
//
// This module must run server-side only — it uses SUPABASE_SERVICE_ROLE_
// KEY and would leak it into the browser bundle if imported clientside.

import { SUPABASE_URL, getServiceKey } from "./api-helpers";

// Create a new session row for this member. Returns the token on success,
// throws on failure. Always also update members.session_token + session_
// expires_at (scalar dual-write) so unmigrated readers keep working.
//
//   memberId     UUID of the member row
//   tenantId     UUID of the tenant (denormalized into member_sessions)
//   token        64-hex string (caller already generated it via
//                crypto.randomBytes)
//   expiresAt    ISO-8601 timestamp
//   opts         { userAgent?: string, ipAddress?: string }
export async function createMemberSession({
  memberId,
  tenantId,
  token,
  expiresAt,
  userAgent,
  ipAddress,
}) {
  if (!memberId || !tenantId || !token || !expiresAt) {
    throw new Error("createMemberSession: missing required field");
  }
  const key = getServiceKey();
  if (!key) throw new Error("createMemberSession: SUPABASE_SERVICE_ROLE_KEY not set");

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/member_sessions`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      token,
      member_id: memberId,
      tenant_id: tenantId,
      expires_at: expiresAt,
      user_agent: userAgent || null,
      ip_address: ipAddress || null,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`member_sessions insert failed: ${resp.status} ${body}`);
  }
  return token;
}

// Look up a session + its member row. Returns { session, member } or null.
//
// During Tier 2 transition we check the new table first; if the token
// isn't there (e.g. a session created before this migration rolled out
// and never got backfilled), fall back to the members.session_token
// scalar. Once PR 2 ships, the fallback branch can be deleted.
//
//   token        raw cookie value
//   tenantId     required — scopes the lookup
//   opts.touch   if true, UPDATE last_used_at to now() (best-effort, fire
//                and forget; never blocks the response)
export async function getSessionWithMember({ token, tenantId, touch = false }) {
  if (!token || !tenantId) return null;
  const key = getServiceKey();
  if (!key) throw new Error("getSessionWithMember: SUPABASE_SERVICE_ROLE_KEY not set");

  const now = new Date().toISOString();

  // 1) New table. Embedded select pulls the member row in one round-trip.
  //    We don't pass expires_at=gt in the query so we can distinguish
  //    "expired" from "not found" if we ever want to surface that later;
  //    current callers just want the binary "valid?" answer.
  try {
    const url =
      `${SUPABASE_URL}/rest/v1/member_sessions` +
      `?token=eq.${encodeURIComponent(token)}` +
      `&tenant_id=eq.${tenantId}` +
      `&expires_at=gt.${encodeURIComponent(now)}` +
      `&select=token,expires_at,created_at,last_used_at,member:members!inner(*)`;
    const resp = await fetch(url, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (resp.ok) {
      const rows = await resp.json();
      if (Array.isArray(rows) && rows.length > 0) {
        const row = rows[0];
        if (touch) {
          // Fire-and-forget is safe here because we don't care about the
          // response and Vercel API routes won't be killed mid-flight
          // since we've already got the data we needed.
          touchSession(token).catch(() => {});
        }
        return { session: row, member: row.member };
      }
    }
  } catch (e) {
    console.warn("member_sessions lookup failed, falling back to scalar:", e.message);
  }

  // 2) Legacy scalar fallback. Remove in PR 2 once all readers use this
  //    helper and the backfill cron has run.
  try {
    const url =
      `${SUPABASE_URL}/rest/v1/members` +
      `?session_token=eq.${encodeURIComponent(token)}` +
      `&tenant_id=eq.${tenantId}` +
      `&session_expires_at=gt.${encodeURIComponent(now)}` +
      `&select=*`;
    const resp = await fetch(url, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!resp.ok) return null;
    const rows = await resp.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const member = rows[0];
    return {
      session: {
        token,
        expires_at: member.session_expires_at,
        // Legacy sessions have no separate row; synthesize enough to look
        // like a member_sessions hit.
        created_at: null,
        last_used_at: null,
      },
      member,
    };
  } catch {
    return null;
  }
}

// Update last_used_at on a session. Best-effort; caller should never wait.
export async function touchSession(token) {
  if (!token) return;
  const key = getServiceKey();
  if (!key) return;
  await fetch(
    `${SUPABASE_URL}/rest/v1/member_sessions?token=eq.${encodeURIComponent(token)}`,
    {
      method: "PATCH",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ last_used_at: new Date().toISOString() }),
    }
  );
}

// Delete a single session (logout on this device). Does not touch the
// scalar columns — callers that want to preserve legacy-logout behavior
// should clear those separately during PR 2.
export async function deleteMemberSession(token) {
  if (!token) return;
  const key = getServiceKey();
  if (!key) return;
  await fetch(
    `${SUPABASE_URL}/rest/v1/member_sessions?token=eq.${encodeURIComponent(token)}`,
    {
      method: "DELETE",
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    }
  );
}

// Delete every active session for a member (logout-everywhere button,
// password reset, admin revoke). Used by the admin "revoke all sessions"
// flow and by member-change-password.
export async function deleteAllMemberSessions(memberId) {
  if (!memberId) return;
  const key = getServiceKey();
  if (!key) return;
  await fetch(
    `${SUPABASE_URL}/rest/v1/member_sessions?member_id=eq.${encodeURIComponent(memberId)}`,
    {
      method: "DELETE",
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    }
  );
}
