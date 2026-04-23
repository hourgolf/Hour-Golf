// Admin-triggered cutover broadcasts — 3 phases of the Skedda → new-
// portal transition communication. Same idempotency pattern as
// /api/admin-broadcast-launch: sends to paying members whose phase-
// specific sent_at column is still NULL, respects opt-outs, marks
// each row only after a successful delivery so retries pick up
// stragglers automatically.
//
// Phases (query param):
//   ?phase=announcement   T−14. Target: all paying members who
//                          haven't received this yet.
//   ?phase=reminder       T−3. Target: all paying members who
//                          (a) haven't received this yet AND
//                          (b) have first_app_login_at IS NULL
//                          (don't nag people who already onboarded).
//   ?phase=complete       T=0. Target: all paying members who haven't
//                          received this yet. Per-recipient behavior
//                          differs — the template takes `alreadyOnApp`
//                          which we derive from first_app_login_at.
//
// Other params:
//   ?date=YYYY-MM-DD      Cutover date; templated into the body.
//                          Required for announcement + reminder.
//   ?dryRun=1             Returns recipient list without sending.
//   ?preview=1            Sends one copy to `?to=` (or admin email)
//                          without touching any sent_at column.
//   ?to=<email>           Preview target.
//   ?limit=N              Send cap this invocation (safety valve).

import {
  SUPABASE_URL, getServiceKey, getTenantId, verifyAdmin, getRequestOrigin,
} from "../../lib/api-helpers";
import {
  sendCutoverAnnouncement,
  sendCutoverReminder,
  sendCutoverComplete,
} from "../../lib/email";

const DEFAULT_LIMIT = 500;

const PHASES = {
  announcement: {
    column: "cutover_announcement_sent_at",
    fn: sendCutoverAnnouncement,
    filterOnlyNotOnApp: false,
    needsDate: true,
    label: "Cutover announcement",
  },
  reminder: {
    column: "cutover_reminder_sent_at",
    fn: sendCutoverReminder,
    filterOnlyNotOnApp: true,
    needsDate: true,
    label: "T−3 reminder",
  },
  complete: {
    column: "cutover_complete_sent_at",
    fn: sendCutoverComplete,
    filterOnlyNotOnApp: false,
    needsDate: false,
    label: "Post-cutover",
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { user, tenantId, reason } = await verifyAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const effectiveTenantId = tenantId || getTenantId(req);
  const phaseKey = String(req.query.phase || "").toLowerCase();
  const phase = PHASES[phaseKey];
  if (!phase) {
    return res.status(400).json({
      error: "phase must be one of: announcement, reminder, complete",
    });
  }

  const cutoverDateRaw = String(req.query.date || "").trim();
  let cutoverDate = null;
  if (cutoverDateRaw) {
    const parsed = new Date(cutoverDateRaw + "T12:00:00");
    if (!isNaN(parsed.getTime())) cutoverDate = parsed;
  }
  if (phase.needsDate && !cutoverDate) {
    return res.status(400).json({
      error: "date param (YYYY-MM-DD) is required for this phase",
    });
  }

  const dryRun = req.query.dryRun === "1" || req.query.dryRun === "true";
  const preview = req.query.preview === "1" || req.query.preview === "true";
  const limit = Math.max(1, Math.min(DEFAULT_LIMIT, Number(req.query.limit) || DEFAULT_LIMIT));
  const portalUrl = getRequestOrigin(req);

  // --- Preview: single send to admin or a specified address ---
  if (preview) {
    const previewTo =
      (typeof req.query.to === "string" && req.query.to.trim()) ||
      user.email ||
      null;
    if (!previewTo) {
      return res.status(400).json({ error: "No preview address. Pass ?to=<email>." });
    }
    try {
      const result = await phase.fn({
        tenantId: effectiveTenantId,
        to: previewTo,
        customerName: user.user_metadata?.name || "Preview",
        portalUrl,
        cutoverDate,
        alreadyOnApp: false, // preview the "not on app yet" variant for complete
      });
      if (result?.error) {
        return res.status(502).json({ error: "Preview send failed", detail: result.detail });
      }
      if (result?.skipped) {
        return res.status(200).json({ preview: true, skipped: true, reason: result.reason, to: previewTo });
      }
      return res.status(200).json({ preview: true, sent: 1, to: previewTo });
    } catch (e) {
      return res.status(500).json({ error: "Preview send failed", detail: e.message });
    }
  }

  // --- Eligibility query ---
  // Paying members, this tenant, phase column is null, optionally also
  // first_app_login_at null (reminder-only filter).
  const params = [
    `tenant_id=eq.${encodeURIComponent(effectiveTenantId)}`,
    `${phase.column}=is.null`,
    `tier=neq.Non-Member`,
    `select=id,email,name,tier,first_app_login_at`,
    `order=created_at.asc`,
    `limit=${limit}`,
  ];
  if (phase.filterOnlyNotOnApp) params.push("first_app_login_at=is.null");

  let members;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/members?${params.join("&")}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!r.ok) throw new Error(`member lookup failed (${r.status})`);
    members = await r.json();
  } catch (e) {
    return res.status(500).json({ error: "lookup failed", detail: e.message });
  }

  // Opt-outs (same rule as the launch broadcast).
  let prefs = {};
  try {
    const emails = members.map((m) => `"${m.email.replace(/"/g, '\\"')}"`).join(",");
    if (emails) {
      const pResp = await fetch(
        `${SUPABASE_URL}/rest/v1/member_preferences?tenant_id=eq.${encodeURIComponent(effectiveTenantId)}&email=in.(${emails})&select=email,email_billing`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      if (pResp.ok) {
        const rows = await pResp.json();
        for (const row of rows) prefs[row.email] = row.email_billing !== false;
      }
    }
  } catch (_) { /* non-fatal; treat as opt-in */ }

  const eligible = members.filter((m) => prefs[m.email] !== false);

  if (dryRun) {
    return res.status(200).json({
      dryRun: true,
      phase: phaseKey,
      wouldSend: eligible.length,
      totalPaying: members.length,
      skippedOptOut: members.length - eligible.length,
      sample: eligible.slice(0, 10).map((m) => ({ email: m.email, name: m.name, tier: m.tier, alreadyOnApp: !!m.first_app_login_at })),
    });
  }

  // --- Send serially, stamp after success ---
  const sent = [];
  const failed = [];
  for (const m of eligible) {
    try {
      const result = await phase.fn({
        tenantId: effectiveTenantId,
        to: m.email,
        customerName: m.name,
        portalUrl,
        cutoverDate,
        alreadyOnApp: !!m.first_app_login_at,
      });
      if (result?.error || result?.skipped) {
        failed.push({ email: m.email, reason: result.detail || result.reason || "send_failed" });
        continue;
      }
      const patch = {};
      patch[phase.column] = new Date().toISOString();
      await fetch(
        `${SUPABASE_URL}/rest/v1/members?id=eq.${encodeURIComponent(m.id)}&tenant_id=eq.${encodeURIComponent(effectiveTenantId)}`,
        {
          method: "PATCH",
          headers: {
            apikey: key, Authorization: `Bearer ${key}`,
            "Content-Type": "application/json", Prefer: "return=minimal",
          },
          body: JSON.stringify(patch),
        }
      );
      sent.push(m.email);
    } catch (e) {
      failed.push({ email: m.email, reason: e.message });
    }
  }

  return res.status(200).json({
    phase: phaseKey,
    sent: sent.length,
    failed: failed.length,
    total: eligible.length,
    failures: failed.slice(0, 20),
  });
}
