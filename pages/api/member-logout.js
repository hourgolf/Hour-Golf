import { SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";
import { deleteMemberSession } from "../../lib/member-session";
import { requireSameOrigin } from "../../lib/security";

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach((c) => {
    const [k, ...v] = c.trim().split("=");
    if (k) cookies[k] = v.join("=");
  });
  return cookies;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!requireSameOrigin(req, res)) return;

  const key = getServiceKey();
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["hg-member-token"];

  // Clear the token in the database if we have one.
  // 1) Delete the specific row in member_sessions.
  // 2) Also null the scalar members.session_token — the WHERE match by
  //    token value means this only hits the row if the scalar still holds
  //    THIS device's token (logging out on device A after device B logged
  //    in leaves the scalar pointing at B, which is correct to preserve).
  //    Once the scalar columns are dropped, this second call goes away.
  if (token && key) {
    try {
      await deleteMemberSession(token);
    } catch (_) { /* best effort */ }
    try {
      await fetch(
        `${SUPABASE_URL}/rest/v1/members?session_token=eq.${encodeURIComponent(token)}`,
        {
          method: "PATCH",
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: JSON.stringify({
            session_token: null,
            session_expires_at: null,
          }),
        }
      );
    } catch (_) { /* best effort */ }
  }

  // Clear the cookie
  const isSecure = process.env.NODE_ENV === "production";
  const cookie = [
    "hg-member-token=",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (isSecure) cookie.push("Secure");
  res.setHeader("Set-Cookie", cookie.join("; "));

  return res.status(200).json({ success: true });
}
