// /api/cron-birthday-bonus
//
// Vercel cron entry point. Scheduled at 16:00 UTC daily (~8am Pacific)
// via vercel.json. For every tenant with birthday-bonus enabled, runs
// the shared processor for that tenant's "today" in Pacific.
//
// Auth: Vercel sets CRON_SECRET as a system env var and attaches
// `Authorization: Bearer <CRON_SECRET>` to cron requests. We reject
// anything without a matching header so the endpoint isn't
// publicly triggerable.

import { SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";
import {
  processBirthdaysForTenant,
  targetDateForTenant,
} from "../../lib/birthday-bonus";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization || "";
  if (!secret || authHeader !== `Bearer ${secret}`) {
    // Deliberately vague — don't leak whether the secret is set.
    return res.status(401).json({ error: "Unauthorized" });
  }

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  try {
    // Only tenants with the feature enabled. Service-role bypasses RLS.
    const cfgResp = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_birthday_bonus_config?enabled=eq.true&select=tenant_id,credit_amount,bonus_hours`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!cfgResp.ok) {
      return res.status(500).json({ error: "Config lookup failed" });
    }
    const configs = await cfgResp.json();

    // Today in Pacific — good enough for US-only tenants. If a tenant
    // ever needs a different timezone, add a tz column to the config.
    const date = targetDateForTenant();

    const results = [];
    for (const cfg of configs) {
      try {
        const result = await processBirthdaysForTenant({
          serviceKey: key,
          tenantId: cfg.tenant_id,
          date,
        });
        results.push({ tenant_id: cfg.tenant_id, ...result });
      } catch (e) {
        results.push({ tenant_id: cfg.tenant_id, error: e.message });
      }
    }

    return res.status(200).json({ date, tenants: results.length, results });
  } catch (e) {
    console.error("cron-birthday-bonus error:", e);
    return res.status(500).json({ error: e.message });
  }
}
