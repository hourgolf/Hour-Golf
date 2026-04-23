import { SUPABASE_URL, getServiceKey, getTenantId } from "../../lib/api-helpers";
import { getSessionWithMember } from "../../lib/member-session";
import { requireSameOrigin } from "../../lib/security";

// Member-facing CRUD for saved shipping addresses.
//
// GET    list
// POST   create { label?, name?, street1, street2?, city, state, zip, country?, phone?, is_default? }
// PATCH  update (?id=) same fields
// DELETE delete (?id=)
//
// Enforces: max 5 addresses per member; at most one is_default=true.
// When an upsert flips is_default=true, clears the flag on the
// member's other addresses first so the DB never holds two defaults.

const MAX_ADDRESSES = 5;

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach((c) => {
    const [k, ...v] = c.trim().split("=");
    if (k) cookies[k] = v.join("=");
  });
  return cookies;
}

function sb(key, path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(opts.headers || {}),
    },
  });
}

function sanitizePayload(body) {
  const fields = ["label", "name", "street1", "street2", "city", "state", "zip", "country", "phone"];
  const out = {};
  for (const f of fields) {
    if (body[f] !== undefined) out[f] = body[f] == null ? null : String(body[f]).trim() || null;
  }
  if (body.is_default !== undefined) out.is_default = !!body.is_default;
  return out;
}

function validateRequired(payload, isCreate) {
  if (!isCreate) return null;
  const need = ["street1", "city", "state", "zip"];
  const missing = need.filter((k) => !payload[k]);
  if (missing.length) return `Missing required fields: ${missing.join(", ")}`;
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    if (!requireSameOrigin(req, res)) return;
  }
  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const tenantId = getTenantId(req);
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["hg-member-token"];
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  try {
    const sess = await getSessionWithMember({ token, tenantId, touch: true });
    if (!sess?.member?.email) return res.status(401).json({ error: "Not authenticated" });
    const memberEmail = sess.member.email;

    if (req.method === "GET") {
      const r = await sb(key, `member_addresses?tenant_id=eq.${tenantId}&member_email=eq.${encodeURIComponent(memberEmail)}&order=is_default.desc,created_at.asc`);
      const rows = r.ok ? await r.json() : [];
      return res.status(200).json({ addresses: rows });
    }

    if (req.method === "POST") {
      const countR = await sb(key, `member_addresses?tenant_id=eq.${tenantId}&member_email=eq.${encodeURIComponent(memberEmail)}&select=id`);
      const existing = countR.ok ? await countR.json() : [];
      if (existing.length >= MAX_ADDRESSES) {
        return res.status(400).json({ error: `Maximum ${MAX_ADDRESSES} addresses per member. Delete one before adding another.` });
      }

      const payload = sanitizePayload(req.body || {});
      const err = validateRequired(payload, true);
      if (err) return res.status(400).json({ error: err });

      // If this is the first address, force is_default=true regardless
      // of what was sent, so the member always has a default to pick.
      if (existing.length === 0) payload.is_default = true;

      // If is_default=true, clear it on siblings first.
      if (payload.is_default) {
        await sb(key, `member_addresses?tenant_id=eq.${tenantId}&member_email=eq.${encodeURIComponent(memberEmail)}`, {
          method: "PATCH",
          body: JSON.stringify({ is_default: false }),
        });
      }

      const insertR = await sb(key, "member_addresses", {
        method: "POST",
        body: JSON.stringify({
          tenant_id: tenantId,
          member_email: memberEmail,
          ...payload,
          label: payload.label || "Home",
          country: payload.country || "US",
        }),
      });
      if (!insertR.ok) throw new Error(await insertR.text());
      const rows = await insertR.json();
      return res.status(201).json(rows[0]);
    }

    if (req.method === "PATCH") {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "id required" });
      const payload = sanitizePayload(req.body || {});
      if (payload.is_default) {
        await sb(key, `member_addresses?tenant_id=eq.${tenantId}&member_email=eq.${encodeURIComponent(memberEmail)}`, {
          method: "PATCH",
          body: JSON.stringify({ is_default: false }),
        });
      }
      const r = await sb(key, `member_addresses?id=eq.${encodeURIComponent(id)}&tenant_id=eq.${tenantId}&member_email=eq.${encodeURIComponent(memberEmail)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(await r.text());
      const rows = await r.json();
      if (!rows.length) return res.status(404).json({ error: "Address not found" });
      return res.status(200).json(rows[0]);
    }

    if (req.method === "DELETE") {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "id required" });
      const r = await sb(key, `member_addresses?id=eq.${encodeURIComponent(id)}&tenant_id=eq.${tenantId}&member_email=eq.${encodeURIComponent(memberEmail)}`, {
        method: "DELETE",
      });
      if (!r.ok) throw new Error(await r.text());
      // If that was the default, promote another address to default.
      const remainingR = await sb(key, `member_addresses?tenant_id=eq.${tenantId}&member_email=eq.${encodeURIComponent(memberEmail)}&select=id,is_default&order=created_at.asc&limit=1`);
      const remaining = remainingR.ok ? await remainingR.json() : [];
      if (remaining[0] && !remaining[0].is_default) {
        await sb(key, `member_addresses?id=eq.${remaining[0].id}&tenant_id=eq.${tenantId}`, {
          method: "PATCH",
          body: JSON.stringify({ is_default: true }),
        });
      }
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("member-addresses error:", e);
    return res.status(500).json({ error: e.message || "Internal error" });
  }
}
