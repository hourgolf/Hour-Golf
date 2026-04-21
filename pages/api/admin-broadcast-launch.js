// Admin-triggered one-off broadcast: sends the launch-announcement
// email to every eligible paying member who hasn't received it yet.
//
// Eligibility:
//   - Member in this tenant, paying tier (not Non-Member).
//   - launch_email_sent_at is NULL (not already notified).
//   - email_preferences.email_billing != false (respects opt-out).
//
// Idempotent by design: re-running the endpoint after onboarding a new
// member sends to them only, leaves prior recipients untouched. If you
// need to re-broadcast on purpose (copy change), null the column first.
//
// Query params:
//   dryRun=1      → returns the recipient list without sending
//   preview=1     → sends ONE test copy to `to` (query or admin email).
//                    Does NOT mark anyone's launch_email_sent_at.
//   to=<email>    → preview target (defaults to the admin's own email)
//   limit=N       → caps the send count this invocation (safety valve)

import { SUPABASE_URL, getServiceKey, getTenantId, verifyAdmin, getRequestOrigin } from "../../lib/api-helpers";
import { sendLaunchEmail } from "../../lib/email";

const DEFAULT_LIMIT = 500;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { user, tenantId, reason } = await verifyAdmin(req);
  if (!user) {
    return res.status(401).json({ error: "Unauthorized", detail: reason });
  }

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const effectiveTenantId = tenantId || getTenantId(req);
  const dryRun = req.query.dryRun === "1" || req.query.dryRun === "true";
  const preview = req.query.preview === "1" || req.query.preview === "true";
  const limit = Math.max(1, Math.min(DEFAULT_LIMIT, Number(req.query.limit) || DEFAULT_LIMIT));
  const portalUrl = getRequestOrigin(req);

  // --- Preview mode: send one copy to the admin (or a specified address),
  // never touch anyone's launch_email_sent_at. Lets the operator see the
  // email in their own inbox, rendered by their real mail client, before
  // firing the broadcast. ---
  if (preview) {
    const previewTo =
      (typeof req.query.to === "string" && req.query.to.trim()) ||
      user.email ||
      null;
    if (!previewTo) {
      return res.status(400).json({ error: "No preview address. Pass ?to=<email> or sign in with an email on your admin account." });
    }
    try {
      const result = await sendLaunchEmail({
        tenantId: effectiveTenantId,
        to: previewTo,
        customerName: user.user_metadata?.name || "Preview",
        portalUrl,
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

  // Pull eligible recipients: paying members in this tenant who haven't
  // been notified yet.
  let members;
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?tenant_id=eq.${encodeURIComponent(effectiveTenantId)}` +
        `&launch_email_sent_at=is.null` +
        `&tier=neq.Non-Member` +
        `&select=id,email,name,tier&order=created_at.asc&limit=${limit}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!resp.ok) throw new Error(`member lookup failed (${resp.status})`);
    members = await resp.json();
  } catch (e) {
    return res.status(500).json({ error: "lookup failed", detail: e.message });
  }

  // Respect opt-outs on email_billing preference. Members who've turned
  // off billing notifications probably don't want a launch broadcast
  // either. Missing preference row = default opt-in (same as the
  // booking-email behavior elsewhere).
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
      wouldSend: eligible.length,
      totalPaying: members.length,
      skippedOptOut: members.length - eligible.length,
      sample: eligible.slice(0, 10).map((m) => ({ email: m.email, name: m.name, tier: m.tier })),
    });
  }

  // Send + mark. We send serially (not parallel) so a Resend rate-limit
  // spike doesn't blow up all attempts; per-send failures are logged but
  // don't abort the run so we at least get the happy cases delivered.
  const sent = [];
  const failed = [];
  for (const m of eligible) {
    try {
      const result = await sendLaunchEmail({
        tenantId: effectiveTenantId,
        to: m.email,
        customerName: m.name,
        portalUrl,
      });
      if (result?.error || result?.skipped) {
        failed.push({ email: m.email, reason: result.detail || result.reason || "send_failed" });
        continue;
      }
      // Mark as sent AFTER a successful delivery so retrying the button
      // after a partial failure picks the stragglers back up.
      await fetch(
        `${SUPABASE_URL}/rest/v1/members?id=eq.${encodeURIComponent(m.id)}&tenant_id=eq.${encodeURIComponent(effectiveTenantId)}`,
        {
          method: "PATCH",
          headers: {
            apikey: key, Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ launch_email_sent_at: new Date().toISOString() }),
        }
      );
      sent.push(m.email);
    } catch (e) {
      failed.push({ email: m.email, reason: e.message });
    }
  }

  return res.status(200).json({
    sent: sent.length,
    failed: failed.length,
    total: eligible.length,
    failures: failed.slice(0, 20),
  });
}
