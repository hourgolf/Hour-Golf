// Get/set the signed-in platform admin's personal UI preferences.
//
// GET  /api/platform-settings
//   → { settings: {...} }   (empty object if no row exists yet)
//
// PATCH /api/platform-settings
//   body: { settings: {...} }   (merged shallowly into existing row)
//   → { settings: {...} }   (the merged row as stored)
//
// Auth: verifyPlatformAdmin. Row is user-keyed — platform admins can only
// read/write their own settings. Uses service_role under the hood
// (same pattern as other platform endpoints) to avoid needing the user's
// JWT to go through RLS.

import { verifyPlatformAdmin } from "../../lib/platform-auth";
import { SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";

export default async function handler(req, res) {
  const { user, reason } = await verifyPlatformAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  if (req.method === "GET") {
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/platform_admin_settings?user_id=eq.${encodeURIComponent(user.id)}&select=settings`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      if (!r.ok) {
        return res.status(500).json({ error: "Load failed", detail: await r.text() });
      }
      const rows = await r.json();
      return res.status(200).json({ settings: rows[0]?.settings || {} });
    } catch (e) {
      return res.status(500).json({ error: "Load failed", detail: e.message });
    }
  }

  if (req.method === "PATCH") {
    const incoming = (req.body && req.body.settings) || null;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
      return res.status(400).json({ error: "Body must contain a settings object" });
    }

    try {
      // Read current row (if any) so we can merge rather than replace.
      // Merge is a one-level shallow merge — platform settings are a flat
      // key/value bag today. If this grows nested, revisit.
      const existingResp = await fetch(
        `${SUPABASE_URL}/rest/v1/platform_admin_settings?user_id=eq.${encodeURIComponent(user.id)}&select=settings`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      let existing = {};
      if (existingResp.ok) {
        const rows = await existingResp.json();
        if (rows[0]?.settings) existing = rows[0].settings;
      }
      const merged = { ...existing, ...incoming };

      // Upsert. Prefer: resolution=merge-duplicates makes POST behave as
      // insert-or-update on the PK (user_id).
      const up = await fetch(`${SUPABASE_URL}/rest/v1/platform_admin_settings`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation,resolution=merge-duplicates",
        },
        body: JSON.stringify({ user_id: user.id, settings: merged }),
      });
      if (!up.ok) {
        return res.status(500).json({ error: "Save failed", detail: await up.text() });
      }
      const saved = await up.json();
      return res.status(200).json({ settings: saved[0]?.settings || merged });
    } catch (e) {
      return res.status(500).json({ error: "Save failed", detail: e.message });
    }
  }

  return res.status(405).json({ error: "GET or PATCH only" });
}
