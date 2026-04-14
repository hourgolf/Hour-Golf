import { useState, useEffect } from "react";
import { useRouter } from "next/router";

export default function MemberEvents({ member, showToast }) {
  const router = useRouter();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadEvents(); }, []);

  async function loadEvents() {
    setLoading(true);
    try {
      const r = await fetch("/api/member-events", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load events");
      setEvents(await r.json());
    } catch (e) {
      showToast("Failed to load events", "error");
    }
    setLoading(false);
  }

  function fmtDate(d) {
    if (!d) return "";
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  if (loading) {
    return (
      <div className="mem-section">
        <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 32 }}>Loading events...</p>
      </div>
    );
  }

  return (
    <div className="mem-section">
      <h2 className="mem-section-title">Events</h2>

      {events.length === 0 && (
        <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 32 }}>No upcoming events right now. Check back soon!</p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
        {events.map((ev) => (
          <div
            key={ev.id}
            onClick={() => router.push(`/members/events/${ev.id}`)}
            style={{
              background: "var(--surface)",
              borderRadius: "var(--radius, 15px)",
              border: "1px solid var(--border)",
              overflow: "hidden",
              cursor: "pointer",
              transition: "box-shadow 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.08)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "none"; }}
          >
            {ev.image_url ? (
              <img src={ev.image_url} alt="" style={{ width: "100%", height: 160, objectFit: "cover" }} />
            ) : (
              <div style={{
                width: "100%", height: 160, background: "var(--border)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 32, color: "var(--text-muted)",
              }}>
                &#9670;
              </div>
            )}

            <div style={{ padding: "12px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 8 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, lineHeight: 1.3 }}>{ev.title}</h3>
                  {ev.subtitle && <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>{ev.subtitle}</p>}
                </div>
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 8,
                  background: Number(ev.cost) > 0 ? "var(--primary)" : "var(--border)",
                  color: Number(ev.cost) > 0 ? "#fff" : "var(--text)",
                  whiteSpace: "nowrap", flexShrink: 0,
                }}>
                  {Number(ev.cost) > 0 ? `$${Number(ev.cost).toFixed(0)}` : "Free"}
                </span>
              </div>

              <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                {fmtDate(ev.start_date)}
                {ev.end_date && ` — ${fmtDate(ev.end_date)}`}
              </p>

              <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                {ev.is_interested && (
                  <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 6, background: "#D1DFCB", color: "#35443B" }}>
                    Interested
                  </span>
                )}
                {ev.registration_status && (
                  <span style={{
                    fontSize: 10, padding: "2px 6px", borderRadius: 6,
                    background: "#4C8D73", color: "#fff",
                  }}>
                    Registered
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
