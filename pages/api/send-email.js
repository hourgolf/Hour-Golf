import { Resend } from "resend";
import { SUPABASE_URL, getServiceKey, getTenantId } from "../../lib/api-helpers";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const tenantId = getTenantId(req);
  const { template_key, to_email, variables, subject_override } = req.body || {};
  if (!template_key || !to_email) {
    return res.status(400).json({ error: "template_key and to_email required" });
  }

  try {
    // 1) Check member preferences (opt-out check) within this tenant
    if (template_key === "booking_confirmation") {
      try {
        const prefResp = await fetch(
          `${SUPABASE_URL}/rest/v1/member_preferences?email=eq.${encodeURIComponent(to_email)}&tenant_id=eq.${tenantId}`,
          { headers: { apikey: key, Authorization: `Bearer ${key}` } }
        );
        if (prefResp.ok) {
          const prefs = await prefResp.json();
          if (prefs.length > 0 && prefs[0].email_booking_confirmations === false) {
            return res.status(200).json({ skipped: true, reason: "opted_out" });
          }
        }
      } catch (_) { /* proceed if preferences lookup fails */ }
    }

    // 2) Lookup email config to get Resend template ID within this tenant
    const configResp = await fetch(
      `${SUPABASE_URL}/rest/v1/email_config?template_key=eq.${encodeURIComponent(template_key)}&tenant_id=eq.${tenantId}&is_active=eq.true`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!configResp.ok) throw new Error("Email config lookup failed");
    const configs = await configResp.json();

    let emailResult;
    let subjectUsed;

    if (configs.length > 0 && configs[0].resend_template_id) {
      // ---- RESEND TEMPLATE MODE ----
      const templateId = configs[0].resend_template_id;

      // Map our variable names to UPPER_SNAKE_CASE for Resend
      const resendVars = {};
      if (variables) {
        for (const [k, v] of Object.entries(variables)) {
          resendVars[k.toUpperCase()] = String(v);
        }
      }

      subjectUsed = subject_override || buildSubject(template_key, variables);

      // Use Resend REST API directly for template sends
      emailResult = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [to_email],
          subject: subjectUsed,
          template_id: templateId,
          template_variables: resendVars,
        }),
      }).then(async (r) => {
        const data = await r.json();
        if (!r.ok) return { error: { message: data.message || JSON.stringify(data) } };
        return { data };
      });

    } else {
      // ---- FALLBACK HTML MODE ----
      subjectUsed = subject_override || buildSubject(template_key, variables);

      emailResult = await resend.emails.send({
        from: FROM_EMAIL,
        to: [to_email],
        subject: subjectUsed,
        html: buildFallbackHtml(template_key, variables),
      });
    }

    // 3) Log the email
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/email_logs`, {
        method: "POST",
        headers: {
          apikey: key, Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tenant_id: tenantId,
          template_key,
          to_email,
          subject: subjectUsed,
          resend_id: emailResult?.data?.id || null,
          status: emailResult?.error ? "failed" : "sent",
          error_detail: emailResult?.error?.message || null,
          metadata: variables || {},
        }),
      });
    } catch (_) { /* logging is best-effort */ }

    if (emailResult?.error) {
      return res.status(500).json({ error: "Email send failed", detail: emailResult.error.message });
    }

    return res.status(200).json({ success: true, id: emailResult?.data?.id });
  } catch (e) {
    console.error("Send email error:", e);
    return res.status(500).json({ error: "Email send failed", detail: e.message });
  }
}

function buildSubject(templateKey, vars) {
  switch (templateKey) {
    case "booking_confirmation":
      return `Booking Confirmed - ${vars?.date || ""}`;
    case "credit_purchase":
      return `Credit Purchase Receipt - ${vars?.hours || ""} Hour${vars?.hours > 1 ? "s" : ""}`;
    default:
      return "Hour Golf Notification";
  }
}

function buildFallbackHtml(templateKey, vars) {
  const v = vars || {};
  const primaryColor = "#1a472a";

  let bodyContent = "";

  switch (templateKey) {
    case "booking_confirmation":
      bodyContent = `
        <h2 style="color:${primaryColor};margin:0 0 16px;font-size:20px;">Booking Confirmed</h2>
        <p>Hi ${v.customer_name || "there"},</p>
        <p>Your bay is booked!</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #eee;color:#888;width:100px;">Date</td>
            <td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600;">${v.date || ""}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #eee;color:#888;">Time</td>
            <td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600;">${v.start_time || ""} &ndash; ${v.end_time || ""}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #eee;color:#888;">Bay</td>
            <td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600;">${v.bay || ""}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#888;">Duration</td>
            <td style="padding:8px 0;font-weight:600;">${v.duration || ""} hours</td>
          </tr>
        </table>
        <p>See you there!</p>
      `;
      break;

    case "credit_purchase":
      bodyContent = `
        <h2 style="color:${primaryColor};margin:0 0 16px;font-size:20px;">Credits Added</h2>
        <p>Hi ${v.customer_name || "there"},</p>
        <p>You purchased <strong>${v.hours || 0} hour${v.hours > 1 ? "s" : ""}</strong> of bay time.</p>
        <p>Your credit balance has been updated.</p>
      `;
      break;

    default:
      bodyContent = `
        <h2 style="color:${primaryColor};margin:0 0 16px;font-size:20px;">Hour Golf</h2>
        <p>You have a new notification from Hour Golf.</p>
      `;
  }

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f3ef;font-family:Inter,'DM Sans',-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ef;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;max-width:100%;">
        <tr><td style="background:${primaryColor};padding:24px;text-align:center;">
          <span style="color:#fff;font-size:18px;letter-spacing:4px;font-weight:700;">HOUR GOLF</span>
        </td></tr>
        <tr><td style="padding:32px;">
          ${bodyContent}
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #e5e5e0;font-size:12px;color:#888;text-align:center;">
          Hour Golf
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
  `.trim();
}
