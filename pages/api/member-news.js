// /api/member-news
//
// GET ?surface=popup     -> active popup news the member hasn't dismissed
// GET ?surface=dashboard -> active dashboard news (dismissals don't apply)
// GET (no surface)       -> { popup: [...], dashboard: [...] }
// POST { news_id }       -> mark a popup dismissed for this member
//
// "Active" means is_published = true AND now() is within
// [starts_at, ends_at] when bounds are set.

import { SUPABASE_URL, getServiceKey, getTenantId } from "../../lib/api-helpers";
import { getSessionWithMember } from "../../lib/member-session";

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach((c) => {
    const [k, ...v] = c.trim().split("=");
    if (k) cookies[k] = v.join("=");
  });
  return cookies;
}

function isActiveNow(item, nowMs) {
  if (item.starts_at && new Date(item.starts_at).getTime() > nowMs) return false;
  if (item.ends_at && new Date(item.ends_at).getTime() < nowMs) return false;
  return true;
}

export default async function handler(req, res) {
  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const tenantId = getTenantId(req);
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["hg-member-token"];
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  const session = await getSessionWithMember({ token, tenantId, touch: false });
  if (!session) return res.status(401).json({ error: "Session expired" });
  const memberEmail = session.member.email;

  if (req.method === "GET") {
    try {
      const surface = req.query.surface;
      const newsResp = await fetch(
        `${SUPABASE_URL}/rest/v1/news_items?tenant_id=eq.${tenantId}&is_published=eq.true&order=display_order.asc,created_at.desc&select=*`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      const all = newsResp.ok ? await newsResp.json() : [];
      const now = Date.now();
      const active = all.filter((n) => isActiveNow(n, now));

      // Dismissals only matter for popups.
      let dismissedSet = new Set();
      if (!surface || surface === "popup") {
        const disResp = await fetch(
          `${SUPABASE_URL}/rest/v1/news_dismissals?tenant_id=eq.${tenantId}&member_email=eq.${encodeURIComponent(memberEmail)}&select=news_id`,
          { headers: { apikey: key, Authorization: `Bearer ${key}` } }
        );
        if (disResp.ok) {
          const rows = await disResp.json();
          dismissedSet = new Set(rows.map((r) => r.news_id));
        }
      }

      const popup = active.filter((n) => n.show_as_popup && !dismissedSet.has(n.id));
      const dashboard = active.filter((n) => n.show_on_dashboard);

      if (surface === "popup") return res.status(200).json(popup);
      if (surface === "dashboard") return res.status(200).json(dashboard);
      return res.status(200).json({ popup, dashboard });
    } catch (e) {
      console.error("member-news GET error:", e);
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "POST") {
    const newsId = (req.body || {}).news_id;
    if (!newsId) return res.status(400).json({ error: "Missing news_id" });
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/news_dismissals`, {
        method: "POST",
        headers: {
          apikey: key, Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation,resolution=merge-duplicates",
        },
        body: JSON.stringify({
          tenant_id: tenantId,
          news_id: newsId,
          member_email: memberEmail,
        }),
      });
      return res.status(200).json({ dismissed: true });
    } catch (e) {
      console.error("member-news POST error:", e);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
