import { useEffect, useMemo, useRef, useState } from "react";

// Global cmd/ctrl+K palette. Fuzzy-matches members by name, email,
// phone, or #member_number, and dispatches the caller's onSelect.
// Render only when `open` is true; the host controls visibility.

function normalizePhone(p) {
  return String(p || "").replace(/[^\d]/g, "");
}

function scoreMember(m, q) {
  if (!q) return 0;
  const name = String(m.name || "").toLowerCase();
  const email = String(m.email || "").toLowerCase();
  const phone = normalizePhone(m.phone);
  const numStr = m.member_number ? `#${String(m.member_number).padStart(3, "0")}` : "";
  const ql = q.toLowerCase();
  const qPhone = normalizePhone(q);

  if (name.startsWith(ql)) return 5;
  if (email.startsWith(ql)) return 4;
  if (numStr.startsWith(ql)) return 4;
  if (qPhone && phone.startsWith(qPhone)) return 4;
  if (name.includes(ql)) return 3;
  if (email.includes(ql)) return 2;
  if (qPhone && phone.includes(qPhone)) return 2;
  if (numStr.includes(ql)) return 2;
  const tokens = name.split(/\s+/);
  if (tokens.some((t) => t.startsWith(ql))) return 2;
  return 0;
}

function tierDotColor(tier, tierColors) {
  const pal = tierColors || {};
  return pal[tier]?.bg || "#6b7d67";
}

export default function CommandPalette({ open, members, tierColors, onSelect, onClose }) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
      const t = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(t);
    }
  }, [open]);

  const results = useMemo(() => {
    if (!open) return [];
    const base = Array.isArray(members) ? members : [];
    const ql = q.trim();
    if (!ql) {
      return base
        .slice()
        .sort((a, b) => String(a.name || a.email || "").localeCompare(String(b.name || b.email || "")))
        .slice(0, 8);
    }
    return base
      .map((m) => ({ m, s: scoreMember(m, ql) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s || String(a.m.name || "").localeCompare(String(b.m.name || "")))
      .slice(0, 8)
      .map((r) => r.m);
  }, [open, members, q]);

  useEffect(() => {
    if (idx >= results.length) setIdx(0);
  }, [results, idx]);

  useEffect(() => {
    if (!open) return;
    function handler(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setIdx((i) => Math.min(results.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const pick = results[idx];
        if (pick?.email) {
          onSelect(pick.email);
        }
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, results, idx, onSelect, onClose]);

  if (!open) return null;

  return (
    <div
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 10000,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, 92vw)",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
          overflow: "hidden",
        }}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIdx(0);
          }}
          placeholder="Search members by name, email, phone, or #number…"
          style={{
            width: "100%",
            border: "none",
            borderBottom: "1px solid var(--border)",
            padding: "14px 16px",
            fontSize: 15,
            fontFamily: "var(--font)",
            background: "transparent",
            color: "var(--text)",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
        <div style={{ maxHeight: 360, overflowY: "auto" }}>
          {results.length === 0 && (
            <div className="muted" style={{ padding: "14px 16px", fontSize: 13 }}>
              {q.trim() ? "No matches." : "Start typing to search members."}
            </div>
          )}
          {results.map((m, i) => {
            const active = i === idx;
            const num = m.member_number
              ? `#${String(m.member_number).padStart(3, "0")}`
              : null;
            return (
              <div
                key={m.email}
                onMouseEnter={() => setIdx(i)}
                onClick={() => onSelect(m.email)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 16px",
                  cursor: "pointer",
                  background: active ? "var(--primary-bg)" : "transparent",
                  borderLeft: active ? "3px solid var(--primary)" : "3px solid transparent",
                }}
              >
                <span
                  title={m.tier || ""}
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: tierDotColor(m.tier, tierColors),
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {m.name || m.email}
                    {num && (
                      <span className="muted" style={{ fontSize: 11, fontWeight: 400, marginLeft: 8, fontFamily: "var(--font-mono)" }}>
                        {num}
                      </span>
                    )}
                  </div>
                  <div className="muted" style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {m.email}
                    {m.phone ? ` · ${m.phone}` : ""}
                    {m.tier ? ` · ${m.tier}` : ""}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div
          className="muted"
          style={{
            display: "flex",
            gap: 12,
            padding: "8px 16px",
            borderTop: "1px solid var(--border)",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
          }}
        >
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
