import { useState, useEffect } from "react";

// Member-submitted "please source this" pro-shop requests. Admin
// reviews, transitions status (pending → acknowledged → ordering →
// in_stock, or declined), optionally adds a note that emails back
// to the member. Moved from Config to the Shop tab 2026-04-23
// because it's operationally a shop workflow, not a setting.

const REQUEST_STATUSES = ["pending", "acknowledged", "ordering", "in_stock", "declined"];
const REQUEST_STATUS_LABEL = {
  pending:      "Pending",
  acknowledged: "Reviewing",
  ordering:     "Sourcing",
  in_stock:     "Ready",
  declined:     "Declined",
  cancelled:    "Cancelled",
};
const REQUEST_STATUS_COLOR = {
  pending:      { bg: "var(--primary-bg)", color: "var(--primary)" },
  acknowledged: { bg: "var(--primary-bg)", color: "var(--primary)" },
  ordering:     { bg: "#ddd480", color: "#35443B" },
  in_stock:     { bg: "var(--primary)", color: "#fff" },
  declined:     { bg: "#8BB5A0", color: "#fff" },
  cancelled:    { bg: "#8BB5A0", color: "#fff" },
};

export default function ShopRequestsSection({ jwt }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [responseDrafts, setResponseDrafts] = useState({});

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/admin-shop-requests", {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (r.ok) {
        const d = await r.json();
        setRequests(d.requests || []);
      }
    } catch {}
    setLoading(false);
  }

  async function updateRequest(id, patch) {
    setSavingId(id);
    try {
      const r = await fetch(`/api/admin-shop-requests?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify(patch),
      });
      if (r.ok) await load();
    } catch {}
    setSavingId(null);
  }

  if (loading) return <div style={{ padding: 12, color: "var(--text-muted)" }}>Loading requests…</div>;
  if (requests.length === 0) {
    return <div style={{ padding: 12, color: "var(--text-muted)", fontSize: 12 }}>No requests yet.</div>;
  }

  const pendingCount = requests.filter((r) => r.status === "pending").length;

  return (
    <>
      {pendingCount > 0 && (
        <div style={{ padding: "8px 12px", background: "var(--primary-bg)", borderRadius: 8, marginBottom: 10, fontSize: 12 }}>
          <strong>{pendingCount}</strong> pending review
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {requests.map((r) => {
          const color = REQUEST_STATUS_COLOR[r.status] || REQUEST_STATUS_COLOR.pending;
          const responseDraft = responseDrafts[r.id] ?? r.admin_response ?? "";
          const responseChanged = responseDraft !== (r.admin_response || "");
          const saving = savingId === r.id;
          return (
            <div
              key={r.id}
              style={{
                padding: 12,
                border: "1px solid var(--border)",
                borderLeft: `4px solid ${color.bg}`,
                borderRadius: 8,
                background: "var(--surface)",
                fontSize: 12,
                display: "flex", flexDirection: "column", gap: 6,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 14 }}>{r.item_name}</strong>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    {r.member_name} &lt;{r.member_email}&gt;{r.member_phone ? ` · ${r.member_phone}` : ""}
                  </div>
                </div>
                <span style={{
                  padding: "2px 10px", borderRadius: 999,
                  background: color.bg, color: color.color,
                  fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4,
                  whiteSpace: "nowrap",
                }}>{REQUEST_STATUS_LABEL[r.status] || r.status}</span>
              </div>

              {(r.brand || r.size || r.color || r.quantity > 1 || r.budget_range) && (
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {[
                    r.brand && `Brand: ${r.brand}`,
                    r.size && `Size: ${r.size}`,
                    r.color && `Color: ${r.color}`,
                    r.quantity > 1 && `Qty: ${r.quantity}`,
                    r.budget_range && `Budget: ${r.budget_range}`,
                  ].filter(Boolean).join(" · ")}
                </div>
              )}

              {r.notes && (
                <div style={{ fontSize: 12, color: "var(--text)", fontStyle: "italic" }}>&ldquo;{r.notes}&rdquo;</div>
              )}

              {r.reference_url && (
                <div style={{ fontSize: 11 }}>
                  <a href={r.reference_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--primary)", fontWeight: 600 }}>
                    Reference link &rarr;
                  </a>
                </div>
              )}

              {r.image_url && (
                <a
                  href={r.image_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open full size"
                  style={{ display: "block", marginTop: 2 }}
                >
                  <img
                    src={r.image_url}
                    alt="Member photo"
                    loading="lazy"
                    decoding="async"
                    style={{ maxWidth: 180, maxHeight: 180, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }}
                  />
                </a>
              )}

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                {REQUEST_STATUSES.map((s) => (
                  <button
                    key={s}
                    className="btn"
                    onClick={() => updateRequest(r.id, { status: s })}
                    disabled={saving || r.status === s}
                    style={{
                      fontSize: 10,
                      ...(r.status === s
                        ? { background: REQUEST_STATUS_COLOR[s].bg, color: REQUEST_STATUS_COLOR[s].color, border: "none" }
                        : {}),
                    }}
                  >
                    {REQUEST_STATUS_LABEL[s]}
                  </button>
                ))}
              </div>

              <div style={{ marginTop: 6 }}>
                <textarea
                  value={responseDraft}
                  onChange={(e) => setResponseDrafts({ ...responseDrafts, [r.id]: e.target.value })}
                  placeholder="Note to member (optional — sent on next save)"
                  rows={2}
                  style={{ width: "100%", padding: 8, border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }}
                />
                {responseChanged && (
                  <button
                    className="btn primary"
                    onClick={() => updateRequest(r.id, { admin_response: responseDraft })}
                    disabled={saving}
                    style={{ fontSize: 10, marginTop: 4 }}
                  >
                    {saving ? "Saving…" : "Save note"}
                  </button>
                )}
              </div>

              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                Submitted {new Date(r.created_at).toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
