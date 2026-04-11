import { useState } from "react";
import Modal from "../ui/Modal";

// Parse various date formats into ISO string
function parseDate(str) {
  if (!str) return str;
  // Already ISO-ish
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str;
  // US format: MM/DD/YY HH:MM AM/PM or MM/DD/YYYY HH:MM AM/PM
  const usMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (usMatch) {
    let [, mo, day, yr, hr, min, ampm] = usMatch;
    if (yr.length === 2) yr = "20" + yr;
    hr = parseInt(hr);
    if (ampm) {
      if (ampm.toUpperCase() === "PM" && hr !== 12) hr += 12;
      if (ampm.toUpperCase() === "AM" && hr === 12) hr = 0;
    }
    return `${yr}-${mo.padStart(2, "0")}-${day.padStart(2, "0")}T${String(hr).padStart(2, "0")}:${min}:00`;
  }
  return str;
}

// Tab-separated column order when no headers
const TSV_COLS = [
  "booking_id", "customer_email", "customer_name",
  "booking_start", "booking_end", "bay",
  "booking_status", "created_at", "duration_hours",
];

export default function SyncModal({ open, onClose, apiKey }) {
  const [data, setData] = useState("");
  const [result, setResult] = useState(null);
  const [syncing, setSyncing] = useState(false);

  async function runSync() {
    if (!data.trim()) return;
    setSyncing(true);
    setResult(null);
    try {
      let rows = [];
      const txt = data.trim();

      if (txt.startsWith("[") || txt.startsWith("{")) {
        // JSON
        rows = JSON.parse(txt.startsWith("{") ? `[${txt}]` : txt);
      } else if (txt.includes("\t") && !txt.split("\n")[0].includes("booking_id")) {
        // Tab-separated without headers
        const lines = txt.split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          const vals = line.split("\t").map((v) => v.trim().replace(/^"|"$/g, ""));
          const obj = {};
          TSV_COLS.forEach((col, i) => { obj[col] = vals[i] || ""; });
          rows.push(obj);
        }
      } else {
        // CSV with headers
        const lines = txt.split("\n");
        const sep = lines[0].includes("\t") ? "\t" : ",";
        const headers = lines[0].split(sep).map((h) => h.trim().replace(/"/g, ""));
        for (let i = 1; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          const vals = lines[i].split(sep).map((v) => v.trim().replace(/^"|"$/g, ""));
          const obj = {};
          headers.forEach((h, j) => { obj[h] = vals[j] || ""; });
          rows.push(obj);
        }
      }

      // Normalize field names and parse dates
      rows = rows
        .map((r) => ({
          booking_id: String(r.booking_id || r.Booking_ID || r.id || ""),
          customer_email: (r.customer_email || r.Customer_Email || r.email || "").toLowerCase().trim(),
          customer_name: r.customer_name || r.Customer_Name || r.name || "",
          booking_start: parseDate(r.booking_start || r.Booking_Start || r.start || ""),
          booking_end: parseDate(r.booking_end || r.Booking_End || r.end || ""),
          duration_hours: parseFloat(r.duration_hours || r.Duration_Hours || r.duration) || 0,
          bay: r.bay || r.Bay || r.space_name || r.Space_Name || "",
          booking_status: r.booking_status || r.Booking_Status || r.status || "Confirmed",
        }))
        .filter((r) => r.booking_id && r.customer_email);

      if (rows.length === 0) {
        setResult({ error: "No valid rows found" });
        setSyncing(false);
        return;
      }

      const resp = await fetch("/api/booking-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(rows),
      });
      const res = await resp.json();
      setResult(res);
    } catch (e) {
      setResult({ error: e.message });
    }
    setSyncing(false);
  }

  function handleClose() {
    onClose();
    setResult(null);
    setData("");
  }

  return (
    <Modal open={open} onClose={handleClose}>
      <h2>Sync Bookings</h2>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
        Paste booking data from your Zapier table (CSV, tab-separated, or JSON). This will insert
        any missing bookings and update existing ones.
      </p>
      <div className="mf">
        <label>Paste data (CSV, TSV, or JSON)</label>
        <textarea
          style={{ width: "100%", minHeight: 120, padding: 10, border: "1px solid var(--border)", borderRadius: 6, fontFamily: "var(--font)", fontSize: 11, background: "var(--surface)", color: "var(--text)", resize: "vertical" }}
          value={data}
          onChange={(e) => setData(e.target.value)}
          placeholder={"booking_id,customer_email,customer_name,booking_start,booking_end,bay,booking_status\n112186710,matt@email.com,Matt,2026-04-09T10:00:00,2026-04-09T10:30:00,Bay 1,Confirmed"}
        />
      </div>
      {result && (
        <div style={{ fontSize: 12, padding: 10, borderRadius: 6, marginBottom: 12, background: result.error ? "var(--red-bg)" : "var(--primary-bg)", color: result.error ? "var(--red)" : "var(--primary)" }}>
          {result.error
            ? `Error: ${result.error}`
            : `Done \u2014 ${result.ok} synced, ${result.failed} failed, ${result.processed} total`}
          {result.results && result.results.filter((r) => r.status === "error").length > 0 && (
            <div style={{ marginTop: 6 }}>
              {result.results.filter((r) => r.status === "error").map((r, i) => (
                <div key={i}>#{r.booking_id}: {r.error}</div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="macts">
        <button className="btn" onClick={handleClose}>Close</button>
        <button className="btn primary" onClick={runSync} disabled={syncing || !data.trim()}>
          {syncing ? "Syncing..." : `Sync ${data.trim() ? "\u2192" : ""}`}
        </button>
      </div>
    </Modal>
  );
}
