// /api/admin-birthday-bonus
//
// GET   -> returns { config, ledger } for this tenant
// PATCH -> update tenant_birthday_bonus_config (enabled, credit_amount,
//         bonus_hours). Null clears an amount.
// POST  -> manually trigger processing for { date: "YYYY-MM-DD" }
//         (defaults to today in Pacific). Idempotent — already-issued
//         members are reported as 'already_issued', not re-credited.
//
// Tenant-admin only. The daily Vercel cron (cron-birthday-bonus.js)
// iterates all tenants in one shot and uses the same shared processor
// in lib/birthday-bonus.js, so this endpoint is primarily for config
// edits + manual runs (testing, backfills, catching up after downtime).

import { verifyAdmin, SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";
import {
  processBirthdaysForTenant,
  targetDateForTenant,
} from "../../lib/birthday-bonus";

export const config = { maxDuration: 60 };

async function sb(key, path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
}

export default async function handler(req, res) {
  const { user, tenantId, reason } = await verifyAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  if (req.method === "GET") {
    const cfgResp = await sb(key, `tenant_birthday_bonus_config?tenant_id=eq.${tenantId}&select=*`);
    const cfg = cfgResp.ok ? (await cfgResp.json())[0] || null : null;

    const ledResp = await sb(
      key,
      `birthday_bonus_ledger?tenant_id=eq.${tenantId}&order=issued_at.desc&limit=50`
    );
    const ledger = ledResp.ok ? await ledResp.json() : [];

    return res.status(200).json({
      config: cfg || {
        tenant_id: tenantId,
        enabled: false,
        credit_amount: null,
        bonus_hours: null,
      },
      ledger,
    });
  }

  if (req.method === "PATCH") {
    const body = req.body || {};
    const update = { updated_at: new Date().toISOString() };
    if ("enabled" in body) {
      if (typeof body.enabled !== "boolean") {
        return res.status(400).json({ error: "enabled must be boolean" });
      }
      update.enabled = body.enabled;
    }
    if ("credit_amount" in body) {
      if (body.credit_amount === null || body.credit_amount === "") {
        update.credit_amount = null;
      } else {
        const n = Number(body.credit_amount);
        if (!isFinite(n) || n < 0 || n > 10000) {
          return res.status(400).json({ error: "credit_amount out of range" });
        }
        update.credit_amount = Math.round(n * 100) / 100;
      }
    }
    if ("bonus_hours" in body) {
      if (body.bonus_hours === null || body.bonus_hours === "") {
        update.bonus_hours = null;
      } else {
        const n = Number(body.bonus_hours);
        if (!isFinite(n) || n < 0 || n > 100) {
          return res.status(400).json({ error: "bonus_hours out of range" });
        }
        update.bonus_hours = Math.round(n * 100) / 100;
      }
    }

    const existingResp = await sb(key, `tenant_birthday_bonus_config?tenant_id=eq.${tenantId}&select=tenant_id`);
    const existing = existingResp.ok ? await existingResp.json() : [];

    let saved;
    try {
      if (existing.length > 0) {
        const r = await sb(key, `tenant_birthday_bonus_config?tenant_id=eq.${tenantId}`, {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify(update),
        });
        if (!r.ok) throw new Error(`update ${r.status} ${await r.text()}`);
        saved = (await r.json())[0];
      } else {
        const r = await sb(key, "tenant_birthday_bonus_config", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ tenant_id: tenantId, ...update }),
        });
        if (!r.ok) throw new Error(`insert ${r.status} ${await r.text()}`);
        saved = (await r.json())[0];
      }
      return res.status(200).json({ config: saved });
    } catch (e) {
      console.error("admin-birthday-bonus patch error:", e);
      return res.status(500).json({ error: "Update failed", detail: e.message });
    }
  }

  if (req.method === "POST") {
    const date = (req.body || {}).date || targetDateForTenant();
    try {
      const result = await processBirthdaysForTenant({
        serviceKey: key,
        tenantId,
        date,
      });
      return res.status(200).json(result);
    } catch (e) {
      console.error("admin-birthday-bonus process error:", e);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
