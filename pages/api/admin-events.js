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
  const { user, tenantId, reason } = await verifyAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  try {
    // GET — list all events with interest + registration counts
    if (req.method === "GET") {
      const evResp = await sb(key, `events?tenant_id=eq.${tenantId}&order=start_date.desc`);
      if (!evResp.ok) throw new Error(`Events fetch: ${evResp.status}`);
      const events = await evResp.json();

      // Get interests and registrations with member details
      const intResp = await sb(key, `event_interests?tenant_id=eq.${tenantId}&select=event_id,member_email,created_at`);
      const interests = intResp.ok ? await intResp.json() : [];
      const regResp = await sb(key, `event_registrations?tenant_id=eq.${tenantId}&select=event_id,member_email,status,amount_cents,created_at`);
      const regs = regResp.ok ? await regResp.json() : [];

      // Get member names for display within this tenant
      const allEmails = new Set([...interests.map((i) => i.member_email), ...regs.map((r) => r.member_email)]);
      const memberNames = {};
      if (allEmails.size > 0) {
        const memResp = await sb(key, `members?tenant_id=eq.${tenantId}&select=email,name`);
        const mems = memResp.ok ? await memResp.json() : [];
        mems.forEach((m) => { memberNames[m.email] = m.name || m.email; });
      }

      // Get comments
      const comResp = await sb(key, `event_comments?tenant_id=eq.${tenantId}&select=event_id,member_email,comment_text,created_at&order=created_at.desc`);
      const comments = comResp.ok ? await comResp.json() : [];
      const comByEvent = {};
      comments.forEach((c) => {
        if (!comByEvent[c.event_id]) comByEvent[c.event_id] = [];
        comByEvent[c.event_id].push({ email: c.member_email, name: memberNames[c.member_email] || c.member_email, comment_text: c.comment_text, created_at: c.created_at });
      });

      // Group by event
      const intByEvent = {};
      interests.forEach((i) => {
        if (!intByEvent[i.event_id]) intByEvent[i.event_id] = [];
        intByEvent[i.event_id].push({ email: i.member_email, name: memberNames[i.member_email] || i.member_email, created_at: i.created_at });
      });
      const regByEvent = {};
      regs.forEach((r) => {
        if (!regByEvent[r.event_id]) regByEvent[r.event_id] = [];
        regByEvent[r.event_id].push({ email: r.member_email, name: memberNames[r.member_email] || r.member_email, status: r.status, amount_cents: r.amount_cents, created_at: r.created_at });
      });

      const enriched = events.map((e) => ({
        ...e,
        interest_count: (intByEvent[e.id] || []).length,
        registration_count: (regByEvent[e.id] || []).length,
        interested_members: intByEvent[e.id] || [],
        registered_members: regByEvent[e.id] || [],
        comment_count: (comByEvent[e.id] || []).length,
        comments: comByEvent[e.id] || [],
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
          tenant_id: tenantId,
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

      const r = await sb(key, `events?id=eq.${id}&tenant_id=eq.${tenantId}`, {
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

      // Cascade FK references before dropping the event itself. Every event
      // child table (interests, registrations, popup_dismissals, comments)
      // has a FK to events(id); without this cascade the DELETE fails with
      // a constraint error whenever any member has interacted with the event.
      await sb(key, `event_interests?event_id=eq.${id}&tenant_id=eq.${tenantId}`, { method: "DELETE" });
      await sb(key, `event_registrations?event_id=eq.${id}&tenant_id=eq.${tenantId}`, { method: "DELETE" });
      await sb(key, `event_popup_dismissals?event_id=eq.${id}&tenant_id=eq.${tenantId}`, { method: "DELETE" });
      await sb(key, `event_comments?event_id=eq.${id}&tenant_id=eq.${tenantId}`, { method: "DELETE" });
      const r = await sb(key, `events?id=eq.${id}&tenant_id=eq.${tenantId}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await r.text());
      return res.status(200).json({ deleted: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("admin-events error:", e);
    return res.status(500).json({ error: e.message });
  }
}
