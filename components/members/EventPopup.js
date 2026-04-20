import { useRouter } from "next/router";
import { optimizedImageUrl } from "../../lib/branding";

export default function EventPopup({ event, onDismiss }) {
  const router = useRouter();
  if (!event) return null;

  function fmtDate(d) {
    if (!d) return "";
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.4)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onDismiss(); }}
    >
      <div style={{
        background: "var(--surface, #fff)", borderRadius: 16,
        maxWidth: 380, width: "100%", overflow: "hidden",
        boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
      }}>
        {event.image_url && (
          <img src={optimizedImageUrl(event.image_url, { width: 828 })} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: 160, objectFit: "cover" }} />
        )}

        <div style={{ padding: "16px 20px 20px" }}>
          <div style={{ fontSize: 11, color: "var(--primary)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
            New Event
          </div>
          <h3 style={{ margin: 0, fontSize: 18, lineHeight: 1.3 }}>{event.title}</h3>
          {event.subtitle && <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-muted)" }}>{event.subtitle}</p>}
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
            {fmtDate(event.start_date)}
          </p>

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button
              onClick={() => router.push(`/members/events/${event.id}`)}
              style={{
                flex: 1, padding: "10px 16px", borderRadius: 10,
                background: "var(--primary)", color: "#fff", border: "none",
                cursor: "pointer", fontSize: 14, fontWeight: 600,
              }}
            >
              Check it out
            </button>
            <button
              onClick={onDismiss}
              style={{
                padding: "10px 16px", borderRadius: 10,
                background: "var(--bg, #EDF3E3)", color: "var(--text)", border: "none",
                cursor: "pointer", fontSize: 14,
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
