import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FALLBACK_EMAIL_FROM = Deno.env.get("EMAIL_FROM") || "Ourlee <onboarding@resend.dev>";

function toPacific(dt: Date): { date: string; time: string } {
  const tz = "America/Los_Angeles";
  const date = dt.toLocaleDateString("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" });
  const time = dt.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true });
  return { date, time };
}

async function createSeamAccessCode(apiKey: string, deviceId: string, name: string, startsAt: string, endsAt: string): Promise<{ accessCodeId: string; code: string }> {
  const resp = await fetch("https://connect.getseam.com/access_codes/create", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ device_id: deviceId, name, starts_at: startsAt, ends_at: endsAt }),
  });
  if (!resp.ok) { const text = await resp.text(); throw new Error(`Seam API ${resp.status}: ${text.substring(0, 500)}`); }
  const data = await resp.json();
  const ac = data.access_code;
  return { accessCodeId: ac.access_code_id, code: ac.code };
}

function buildEmailHtml(venueName: string, customerName: string, bay: string, bookingStart: Date, bookingEnd: Date, accessCode: string, footerText: string): string {
  const start = toPacific(bookingStart);
  const end = toPacific(bookingEnd);
  return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="margin: 0 0 16px 0; font-size: 20px;">Your ${venueName} Access Code \ud83d\udd11</h2>
  <p style="margin: 0 0 16px 0;">Hey ${customerName || "there"},</p>
  <p style="margin: 0 0 16px 0;">Your booking at ${venueName} is coming up:</p>
  <div style="background: #e7efd8; border-radius: 8px; padding: 16px; margin: 0 0 16px 0;">
    <p style="margin: 0 0 8px 0;">\ud83d\udcc5 <strong>${start.date}</strong></p>
    <p style="margin: 0 0 8px 0;">\ud83d\udd50 <strong>${start.time} \u2013 ${end.time}</strong></p>
    ${bay ? `<p style="margin: 0;">\ud83d\udccd <strong>${bay}</strong></p>` : ""}
  </div>
  <div style="background: #006044; color: #ffffff; border-radius: 8px; padding: 20px; text-align: center; margin: 0 0 16px 0;">
    <p style="margin: 0 0 4px 0; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; opacity: 0.7;">Your Access Code</p>
    <p style="margin: 0; font-size: 36px; font-weight: bold; letter-spacing: 6px; font-family: 'SF Mono', Monaco, 'Courier New', monospace;">${accessCode}</p>
  </div>
  <p style="margin: 0 0 16px 0; font-size: 14px; color: #666;">This code works from 10 minutes before your booking through 10 minutes after. Enter it on the keypad at the front door.</p>
  <p style="margin: 0 0 4px 0;">See you soon!</p>
  <p style="margin: 0; color: #666; font-size: 14px;">\u2014 ${footerText}</p>
</div>
`;
}

async function sendAccessCodeEmail(emailFrom: string, venueName: string, footerText: string, to: string, customerName: string, bay: string, bookingStart: Date, bookingEnd: Date, accessCode: string): Promise<void> {
  const html = buildEmailHtml(venueName, customerName, bay, bookingStart, bookingEnd, accessCode, footerText);
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: emailFrom, to: [to], subject: `Your ${venueName} Access Code \ud83d\udd11`, html }),
  });
  if (!resp.ok) { const text = await resp.text(); throw new Error(`Resend API ${resp.status}: ${text.substring(0, 500)}`); }
}

type TenantCtx = { seamApiKey: string; seamDeviceId: string; seamEnabled: boolean; accessCodesEnabled: boolean; venueName: string; emailFrom: string; footerText: string; };

async function loadTenantCtx(supabase: ReturnType<typeof createClient>, tenantId: string): Promise<TenantCtx | null> {
  const { data: seamRows } = await supabase.from("tenant_seam_config").select("api_key, device_id, enabled").eq("tenant_id", tenantId).limit(1);
  const seam = seamRows?.[0];
  const { data: tenantRows } = await supabase.from("tenants").select("name, email_from, email_footer_text").eq("id", tenantId).limit(1);
  const tenant = tenantRows?.[0];
  const { data: featRows } = await supabase.from("tenant_features").select("enabled").eq("tenant_id", tenantId).eq("feature_key", "access_codes").limit(1);
  const accessCodesEnabled = featRows?.[0]?.enabled ?? true;
  if (!seam || !seam.api_key || !seam.device_id) return null;
  const venueName = tenant?.name || "Ourlee";
  return {
    seamApiKey: seam.api_key,
    seamDeviceId: seam.device_id,
    seamEnabled: !!seam.enabled,
    accessCodesEnabled,
    venueName,
    emailFrom: tenant?.email_from || FALLBACK_EMAIL_FROM,
    footerText: tenant?.email_footer_text || venueName,
  };
}

Deno.serve(async (_req: Request) => {
  if (!RESEND_API_KEY) {
    console.error("Missing RESEND_API_KEY");
    return new Response(JSON.stringify({ error: "Missing secrets", missing: ["RESEND_API_KEY"] }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const cutoff = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  const { data: jobs, error: queryError } = await supabase.from("access_code_jobs").select("*").in("status", ["pending", "failed"]).lte("code_start", cutoff).order("code_start", { ascending: true }).limit(20);

  if (queryError) {
    console.error("Query error:", queryError.message);
    return new Response(JSON.stringify({ error: "Query failed", detail: queryError.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  if (!jobs || jobs.length === 0) {
    return new Response(JSON.stringify({ processed: 0, message: "No jobs due" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  console.log(`Processing ${jobs.length} access code job(s)`);
  const results: any[] = [];
  const tenantCache = new Map<string, TenantCtx | null>();

  async function getTenantCtx(tenantId: string): Promise<TenantCtx | null> {
    if (tenantCache.has(tenantId)) return tenantCache.get(tenantId)!;
    const ctx = await loadTenantCtx(supabase, tenantId);
    tenantCache.set(tenantId, ctx);
    return ctx;
  }

  for (const job of jobs) {
    try {
      const ctx = await getTenantCtx(job.tenant_id);

      if (!ctx) {
        await supabase.from("access_code_jobs").update({ status: "failed_permanent", error_message: `[config] no tenant_seam_config or missing keys for tenant ${job.tenant_id}` }).eq("id", job.id);
        results.push({ booking_id: job.booking_id, status: "failed_permanent", reason: "no_seam_config" });
        continue;
      }

      if (!ctx.accessCodesEnabled) {
        await supabase.from("access_code_jobs").update({ status: "cancelled", processed_at: new Date().toISOString(), error_message: "[feature] access_codes disabled for tenant" }).eq("id", job.id);
        results.push({ booking_id: job.booking_id, status: "cancelled", reason: "feature_disabled" });
        continue;
      }

      if (!ctx.seamEnabled) {
        await supabase.from("access_code_jobs").update({ status: "cancelled", processed_at: new Date().toISOString(), error_message: "[config] seam_enabled=false for tenant" }).eq("id", job.id);
        results.push({ booking_id: job.booking_id, status: "cancelled", reason: "seam_disabled" });
        continue;
      }

      const { count } = await supabase.from("access_code_jobs").update({ status: "processing" }).eq("id", job.id).eq("status", job.status).select("id", { count: "exact", head: true });

      if (count === 0) {
        results.push({ booking_id: job.booking_id, status: "skipped", reason: "already claimed" });
        continue;
      }

      const { data: booking } = await supabase.from("bookings").select("booking_status").eq("booking_id", job.booking_id).eq("tenant_id", job.tenant_id).single();

      if (!booking || booking.booking_status === "Cancelled") {
        await supabase.from("access_code_jobs").update({ status: "cancelled", processed_at: new Date().toISOString() }).eq("id", job.id);
        results.push({ booking_id: job.booking_id, status: "cancelled", reason: "booking no longer confirmed" });
        continue;
      }

      let accessCodeId = job.seam_access_code_id || null;
      let code = job.access_code || null;

      if (!accessCodeId) {
        const seamName = `${job.customer_name || job.customer_email} - ${job.bay || ctx.venueName}`;
        const seamResult = await createSeamAccessCode(ctx.seamApiKey, ctx.seamDeviceId, seamName, job.code_start, job.code_end);
        accessCodeId = seamResult.accessCodeId;
        code = seamResult.code;
        await supabase.from("access_code_jobs").update({ seam_access_code_id: accessCodeId, access_code: code }).eq("id", job.id);
        console.log(`Seam code created for ${job.booking_id} (tenant ${job.tenant_id}): ${code.substring(0, 2)}**`);
      } else {
        console.log(`Seam code already exists for ${job.booking_id}, skipping creation`);
      }

      await sendAccessCodeEmail(ctx.emailFrom, ctx.venueName, ctx.footerText, job.customer_email, job.customer_name || "", job.bay || "", new Date(job.booking_start), new Date(job.booking_end), code!);
      console.log(`Email sent for ${job.booking_id} to ${job.customer_email}`);

      await supabase.from("access_code_jobs").update({ status: "sent", seam_access_code_id: accessCodeId, access_code: code, processed_at: new Date().toISOString(), error_message: null }).eq("id", job.id);
      results.push({ booking_id: job.booking_id, status: "sent", code_preview: code!.substring(0, 2) + "**" });
    } catch (err) {
      const errMsg = String(err);
      console.error(`Failed for ${job.booking_id}:`, errMsg);
      const retryCount = (job.error_message || "").startsWith("[retry") ? parseInt((job.error_message || "").match(/\[retry (\d+)/)?.[1] || "0") + 1 : 1;
      const maxRetries = 3;
      const newStatus = retryCount >= maxRetries ? "failed_permanent" : "failed";
      const errorPrefix = `[retry ${retryCount}/${maxRetries}] `;
      await supabase.from("access_code_jobs").update({ status: newStatus, error_message: errorPrefix + errMsg.substring(0, 950) }).eq("id", job.id);
      results.push({ booking_id: job.booking_id, status: newStatus, retry: retryCount, error: errMsg.substring(0, 200) });
    }
  }

  return new Response(JSON.stringify({ processed: results.length, results }), { status: 200, headers: { "Content-Type": "application/json" } });
});
