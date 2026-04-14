import { verifyAdmin, getServiceKey, SUPABASE_URL } from "../../lib/api-helpers";

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

export default async function handler(req, res) {
  const { user, reason } = await verifyAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  try {
    // GET — list all events with interest + registration counts
    if (req.method === "GET") {
      const evResp = await sb(key, "events?order=start_date.desc");
      if (!evResp.ok) throw new Error(`Events fetch: ${evResp.status}`);
      const events = await evResp.json();

      // Get counts
      const intResp = await sb(key, "event_interests?select=event_id");
      const interests = intResp.ok ? await intResp.json() : [];
      const regResp = await sb(key, "event_registrations?select=event_id,status");
      const regs = regResp.ok ? await regResp.json() : [];

      const intCounts = {};
      interests.forEach((i) => { intCounts[i.event_id] = (intCounts[i.event_id] || 0) + 1; });
      const regCounts = {};
      regs.forEach((r) => { regCounts[r.event_id] = (regCounts[r.event_id] || 0) + 1; });

      const enriched = events.map((e) => ({
        ...e,
        interest_count: intCounts[e.id] || 0,
        registration_count: regCounts[e.id] || 0,
      }));

      return res.status(200).json(enriched);
    }

    // POST — create event
    if (req.method === "POST") {
      const { title, subtitle, description, image_url, cost, start_date, end_date, show_popup, is_published } = req.body;
      if (!title || !start_date) return res.status(400).json({ error: "Title and start_date required" });

      const r = await sb(key, "events", {
        method: "POST",
        body: JSON.stringify({
          title, subtitle: subtitle || null, description: description || null,
          image_url: image_url || null, cost: Number(cost || 0),
          start_date, end_date: end_date || null,
          show_popup: !!show_popup, is_published: is_published !== false,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const rows = await r.json();
      return res.status(201).json(rows[0]);
    }

    // PATCH — update event
    if (req.method === "PATCH") {
      const id = req.query.id || req.body.id;
      if (!id) return res.status(400).json({ error: "Missing event id" });

      const data = { ...req.body, updated_at: new Date().toISOString() };
      delete data.id;
      if (data.cost !== undefined) data.cost = Number(data.cost);

      const r = await sb(key, `events?id=eq.${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error(await r.text());
      const rows = await r.json();
      return res.status(200).json(rows[0]);
    }

    // DELETE — remove event
    if (req.method === "DELETE") {
      const id = req.query.id || req.body.id;
      if (!id) return res.status(400).json({ error: "Missing event id" });

      const r = await sb(key, `events?id=eq.${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await r.text());
      return res.status(200).json({ deleted: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("admin-events error:", e);
    return res.status(500).json({ error: e.message });
  }
}
