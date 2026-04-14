import { useState, useEffect, useCallback } from "react";
import Modal from "../ui/Modal";
import Confirm from "../ui/Confirm";

function EventFormModal({ open, onClose, event, onSave, apiKey }) {
  const [form, setForm] = useState({
    title: "", subtitle: "", description: "", image_url: "",
    cost: 0, start_date: "", end_date: "", show_popup: false, is_published: true,
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (event) {
      setForm({
        title: event.title || "",
        subtitle: event.subtitle || "",
        description: event.description || "",
        image_url: event.image_url || "",
        cost: Number(event.cost || 0),
        start_date: event.start_date ? event.start_date.slice(0, 16) : "",
        end_date: event.end_date ? event.end_date.slice(0, 16) : "",
        show_popup: !!event.show_popup,
        is_published: event.is_published !== false,
      });
    } else {
      setForm({
        title: "", subtitle: "", description: "", image_url: "",
        cost: 0, start_date: "", end_date: "", show_popup: false, is_published: true,
      });
    }
  }, [event, open]);

  function update(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function handleImage(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert("Max 5MB"); return; }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const name = `event_${Date.now()}.${ext}`;
      const r = await fetch(`/api/upload-event-image?filename=${name}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": file.type },
        body: file,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error);
      update("image_url", d.url);
    } catch (err) {
      alert("Upload failed: " + err.message);
    }
    setUploading(false);
  }

  async function handleSave() {
    if (!form.title.trim() || !form.start_date) return;
    setSaving(true);
    await onSave({
      ...form,
      title: form.title.trim(),
      subtitle: form.subtitle.trim() || null,
      description: form.description.trim() || null,
      cost: Number(form.cost || 0),
      start_date: new Date(form.start_date).toISOString(),
      end_date: form.end_date ? new Date(form.end_date).toISOString() : null,
    }, !!event);
    setSaving(false);
  }

  return (
    <Modal open={open} onClose={onClose}>
      <h2>{event ? "Edit Event" : "New Event"}</h2>

      {/* Image */}
      <div className="mf">
        <label>Event Image</label>
        {form.image_url && (
          <img src={form.image_url} alt="" style={{ width: "100%", maxHeight: 180, objectFit: "cover", borderRadius: 8, marginBottom: 8 }} />
        )}
        <input type="file" accept="image/*" onChange={handleImage} disabled={uploading} />
        {uploading && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Uploading...</span>}
      </div>

      {/* Title / Subtitle */}
      <div className="mf">
        <label>Title *</label>
        <input value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="Spring Tournament" />
      </div>
      <div className="mf">
        <label>Subtitle</label>
        <input value={form.subtitle} onChange={(e) => update("subtitle", e.target.value)} placeholder="Members only — limited spots" />
      </div>

      {/* Dates */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="mf">
          <label>Start Date *</label>
          <input type="datetime-local" value={form.start_date} onChange={(e) => update("start_date", e.target.value)} />
        </div>
        <div className="mf">
          <label>End Date</label>
          <input type="datetime-local" value={form.end_date} onChange={(e) => update("end_date", e.target.value)} />
        </div>
      </div>

      {/* Cost */}
      <div className="mf">
        <label>Cost ($) — 0 = Free</label>
        <input type="number" min={0} step="0.01" value={form.cost} onChange={(e) => update("cost", e.target.value)} />
      </div>

      {/* Description */}
      <div className="mf">
        <label>Description</label>
        <textarea rows={4} value={form.description} onChange={(e) => update("description", e.target.value)} placeholder="Event details, rules, what to bring..." style={{ width: "100%", resize: "vertical" }} />
      </div>

      {/* Toggles */}
      <div style={{ display: "flex", gap: 24, margin: "12px 0" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", textTransform: "none", fontWeight: 400, letterSpacing: 0, color: "var(--text)" }}>
          <input type="checkbox" checked={form.is_published} onChange={(e) => update("is_published", e.target.checked)} />
          Published
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", textTransform: "none", fontWeight: 400, letterSpacing: 0, color: "var(--text)" }}>
          <input type="checkbox" checked={form.show_popup} onChange={(e) => update("show_popup", e.target.checked)} />
          Show Login Popup
        </label>
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={handleSave} disabled={saving || !form.title.trim() || !form.start_date}>
          {saving ? "Saving..." : event ? "Update" : "Create"}
        </button>
      </div>
    </Modal>
  );
}

function MemberListModal({ open, onClose, title, members, type }) {
  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose}>
      <h2>{title}</h2>
      {members.length === 0 && (
        <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 16 }}>None yet.</p>
      )}
      {members.length > 0 && (
        <div className="tbl" style={{ marginTop: 8 }}>
          <div className="th">
            <span style={{ flex: 2 }}>Member</span>
            {type === "registered" && <span style={{ flex: 1 }} className="text-r">Status</span>}
            {type === "registered" && <span style={{ flex: 1 }} className="text-r">Amount</span>}
            <span style={{ flex: 1 }} className="text-r">Date</span>
          </div>
          {members.map((m, i) => (
            <div key={i} className="tr">
              <span style={{ flex: 2 }}>
                <strong>{m.name}</strong><br />
                <span className="email-sm">{m.email}</span>
              </span>
              {type === "registered" && (
                <span style={{ flex: 1 }} className="text-r">
                  <span className="badge" style={{
                    fontSize: 9,
                    background: m.status === "paid" ? "#4C8D73" : m.status === "registered" ? "var(--primary)" : "var(--text-muted)",
                    color: "#fff",
                  }}>
                    {(m.status || "registered").toUpperCase()}
                  </span>
                </span>
              )}
              {type === "registered" && (
                <span style={{ flex: 1 }} className="text-r tab-num">
                  {m.amount_cents ? `$${(m.amount_cents / 100).toFixed(0)}` : "Free"}
                </span>
              )}
              <span style={{ flex: 1, textAlign: "right", fontSize: 11, color: "var(--text-muted)" }}>
                {m.created_at ? new Date(m.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}
              </span>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

export default function EventsView({ apiKey }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editEvent, setEditEvent] = useState(null);
  const [delTarget, setDelTarget] = useState(null);
  const [memberList, setMemberList] = useState(null);

  const fetchEvents = useCallback(async () => {
    try {
      const r = await fetch("/api/admin-events", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (r.ok) setEvents(await r.json());
    } catch {}
    setLoading(false);
  }, [apiKey]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  async function handleSave(data, isEdit) {
    try {
      const url = isEdit ? `/api/admin-events?id=${editEvent.id}` : "/api/admin-events";
      const r = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(data),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
      setEditEvent(null);
      await fetchEvents();
    } catch (e) {
      alert("Save failed: " + e.message);
    }
  }

  async function handleDelete() {
    if (!delTarget) return;
    try {
      await fetch(`/api/admin-events?id=${delTarget.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      setDelTarget(null);
      await fetchEvents();
    } catch {}
  }

  async function togglePopup(ev) {
    try {
      await fetch(`/api/admin-events?id=${ev.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ show_popup: !ev.show_popup }),
      });
      await fetchEvents();
    } catch {}
  }

  function fmtDate(d) {
    if (!d) return "\u2014";
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  if (loading) return <div className="content"><p style={{ color: "var(--text-muted)" }}>Loading events...</p></div>;

  return (
    <div className="content">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 className="section-head" style={{ margin: 0 }}>Events</h2>
        <button className="btn primary" onClick={() => setEditEvent({})}>+ New Event</button>
      </div>

      {events.length === 0 && (
        <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 32 }}>No events yet. Create your first event!</p>
      )}

      <div className="tbl">
        {events.length > 0 && (
          <div className="th">
            <span style={{ flex: 0.5 }}></span>
            <span style={{ flex: 2 }}>Event</span>
            <span style={{ flex: 1 }}>Dates</span>
            <span style={{ flex: 0.7 }} className="text-r">Cost</span>
            <span style={{ flex: 0.7 }} className="text-c">Interested</span>
            <span style={{ flex: 0.7 }} className="text-c">Registered</span>
            <span style={{ flex: 0.7 }} className="text-c">Popup</span>
            <span style={{ flex: 1 }} className="text-r">Actions</span>
          </div>
        )}
        {events.map((ev) => (
          <div key={ev.id} className="tr">
            <span style={{ flex: 0.5 }}>
              {ev.image_url ? (
                <img src={ev.image_url} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6 }} />
              ) : (
                <div style={{ width: 40, height: 40, borderRadius: 6, background: "var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "var(--text-muted)" }}>
                  &#9670;
                </div>
              )}
            </span>
            <span style={{ flex: 2 }}>
              <strong>{ev.title}</strong>
              {ev.subtitle && <><br /><span className="email-sm">{ev.subtitle}</span></>}
              {!ev.is_published && <span className="badge" style={{ background: "var(--text-muted)", fontSize: 8, marginLeft: 6 }}>DRAFT</span>}
            </span>
            <span style={{ flex: 1, fontSize: 12 }}>
              {fmtDate(ev.start_date)}
              {ev.end_date && <><br />{fmtDate(ev.end_date)}</>}
            </span>
            <span style={{ flex: 0.7 }} className="text-r tab-num">
              {Number(ev.cost) > 0 ? `$${Number(ev.cost).toFixed(0)}` : "Free"}
            </span>
            <span style={{ flex: 0.7 }} className="text-c tab-num">
              {ev.interest_count > 0 ? (
                <button
                  className="btn"
                  style={{ fontSize: 11, padding: "1px 8px", minWidth: 28 }}
                  onClick={() => setMemberList({ title: `Interested — ${ev.title}`, members: ev.interested_members || [], type: "interested" })}
                >
                  {ev.interest_count}
                </button>
              ) : (
                <span className="muted">0</span>
              )}
            </span>
            <span style={{ flex: 0.7 }} className="text-c tab-num">
              {ev.registration_count > 0 ? (
                <button
                  className="btn"
                  style={{ fontSize: 11, padding: "1px 8px", minWidth: 28 }}
                  onClick={() => setMemberList({ title: `Registered — ${ev.title}`, members: ev.registered_members || [], type: "registered" })}
                >
                  {ev.registration_count}
                </button>
              ) : (
                <span className="muted">0</span>
              )}
            </span>
            <span style={{ flex: 0.7 }} className="text-c">
              <label style={{ cursor: "pointer", display: "inline-flex", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={ev.show_popup}
                  onChange={() => togglePopup(ev)}
                />
              </label>
            </span>
            <span style={{ flex: 1 }} className="text-r">
              <button className="btn" style={{ fontSize: 10, padding: "2px 8px", marginRight: 4 }} onClick={() => setEditEvent(ev)}>Edit</button>
              <button className="btn" style={{ fontSize: 10, padding: "2px 8px", color: "var(--red)" }} onClick={() => setDelTarget(ev)}>Delete</button>
            </span>
          </div>
        ))}
      </div>

      <EventFormModal
        open={editEvent !== null}
        onClose={() => setEditEvent(null)}
        event={editEvent?.id ? editEvent : null}
        onSave={handleSave}
        apiKey={apiKey}
      />

      <Confirm
        open={!!delTarget}
        onClose={() => setDelTarget(null)}
        onOk={handleDelete}
        title="Delete Event"
        msg={delTarget ? `Delete "${delTarget.title}"? This also removes all interests and registrations.` : ""}
        label="Delete"
        danger
      />

      <MemberListModal
        open={!!memberList}
        onClose={() => setMemberList(null)}
        title={memberList?.title || ""}
        members={memberList?.members || []}
        type={memberList?.type || "interested"}
      />
    </div>
  );
}
