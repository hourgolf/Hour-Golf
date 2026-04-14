import { useState, useEffect } from "react";
import { useRouter } from "next/router";

export default function MemberEventDetail({ id, member, showToast }) {
  const router = useRouter();
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  useEffect(() => {
    if (id) loadEvent();
  }, [id]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("registered") === "true") {
        showToast("Successfully registered!");
        window.history.replaceState({}, "", `/members/events/${id}`);
      }
    }
  }, []);

  async function loadEvent() {
    setLoading(true);
    try {
      const r = await fetch(`/api/member-event-detail?id=${id}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load event");
      setEvent(await r.json());
    } catch (e) {
      showToast("Failed to load event", "error");
    }
    setLoading(false);
  }

  async function toggleInterest() {
    setActing(true);
    try {
      const r = await fetch("/api/member-event-interest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ event_id: id }),
      });
      if (!r.ok) throw new Error("Failed");
      const d = await r.json();
      showToast(d.interested ? "Marked as interested!" : "Removed interest");
      await loadEvent();
    } catch (e) {
      showToast("Failed to update interest", "error");
    }
    setActing(false);
  }

  async function handleRegister() {
    setActing(true);
    try {
      const r = await fetch("/api/member-event-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ event_id: id }),
      });
      const d = await r.json();
      if (!r.ok) {
        if (d.error === "Already registered") { showToast("You're already registered!"); }
        else throw new Error(d.error);
        setActing(false);
        return;
      }
      if (d.url) {
        window.location.href = d.url;
        return;
      }
      showToast("Successfully registered!");
      await loadEvent();
    } catch (e) {
      showToast("Registration failed: " + e.message, "error");
    }
    setActing(false);
  }

  function fmtDate(d) {
    if (!d) return "";
    return new Date(d).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }

  if (loading) {
    return (
      <div className="mem-section">
        <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 32 }}>Loading...</p>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="mem-section">
        <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 32 }}>Event not found.</p>
        <div style={{ textAlign: "center" }}>
          <button className="mem-btn" onClick={() => router.push("/members/events")}>Back to Events</button>
        </div>
      </div>
    );
  }

  const cost = Number(event.cost || 0);
  const isRegistered = !!event.registration_status;

  return (
    <div className="mem-section">
      <button
        onClick={() => router.push("/members/events")}
        style={{ background: "none", border: "none", color: "var(--primary)", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 16 }}
      >
        &larr; All Events
      </button>

      {event.image_url && (
        <img src={event.image_url} alt="" style={{
          width: "100%", maxHeight: 300, objectFit: "cover", borderRadius: "var(--radius, 15px)", marginBottom: 16,
        }} />
      )}

      <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.3 }}>{event.title}</h1>
      {event.subtitle && <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--text-muted)" }}>{event.subtitle}</p>}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, margin: "16px 0", fontSize: 13 }}>
        <div>
          <span style={{ color: "var(--text-muted)" }}>Date: </span>
          <strong>{fmtDate(event.start_date)}</strong>
          {event.end_date && <> — <strong>{fmtDate(event.end_date)}</strong></>}
        </div>
        <div>
          <span style={{ color: "var(--text-muted)" }}>Cost: </span>
          <strong>{cost > 0 ? `$${cost.toFixed(2)}` : "Free"}</strong>
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, margin: "12px 0", fontSize: 13, color: "var(--text-muted)" }}>
        <span>{event.interest_count} interested</span>
        <span>{event.registration_count} registered</span>
      </div>

      <div style={{ display: "flex", gap: 12, margin: "20px 0" }}>
        <button
          className="mem-btn"
          onClick={toggleInterest}
          disabled={acting}
          style={{
            background: event.is_interested ? "var(--primary)" : "var(--surface)",
            color: event.is_interested ? "#fff" : "var(--text)",
            border: `1px solid ${event.is_interested ? "var(--primary)" : "var(--border)"}`,
            padding: "10px 20px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600,
          }}
        >
          {event.is_interested ? "\u{1F44D} Interested" : "\u{1F44D} I'm Interested"}
        </button>

        {isRegistered ? (
          <button
            className="mem-btn"
            disabled
            style={{
              background: "#4C8D73", color: "#fff", border: "none",
              padding: "10px 20px", borderRadius: 10, fontSize: 14, fontWeight: 600, opacity: 0.9,
            }}
          >
            Registered
          </button>
        ) : (
          <button
            className="mem-btn"
            onClick={handleRegister}
            disabled={acting}
            style={{
              background: "var(--primary)", color: "#fff", border: "none",
              padding: "10px 20px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600,
            }}
          >
            {acting ? "Processing..." : cost > 0 ? `Register ($${cost.toFixed(0)})` : "Register (Free)"}
          </button>
        )}
      </div>

      {event.description && (
        <div style={{ marginTop: 24, lineHeight: 1.7, fontSize: 14, whiteSpace: "pre-wrap" }}>
          {event.description}
        </div>
      )}
    </div>
  );
}
