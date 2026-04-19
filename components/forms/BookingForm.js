import { useState, useEffect, useMemo } from "react";
import { tds } from "../../lib/format";
import { useBranding } from "../../hooks/useBranding";
import { resolveBays, resolveBayLabel } from "../../lib/branding";
import Modal from "../ui/Modal";

export default function BookingForm({ open, onClose, onSave, booking, customers, presetEmail }) {
  const branding = useBranding();
  const BAYS = useMemo(() => resolveBays(branding), [branding]);
  const bayLabel = resolveBayLabel(branding);
  const defaultBay = BAYS[0] || "Bay 1";

  const isEdit = !!booking;
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("11:00");
  const [bay, setBay] = useState(defaultBay);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && booking) {
      setEmail(booking.customer_email || "");
      setName(booking.customer_name || "");
      const s = new Date(booking.booking_start);
      const e = new Date(booking.booking_end);
      setDate(s.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }));
      setStartTime(s.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "America/Los_Angeles" }));
      setEndTime(e.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "America/Los_Angeles" }));
      setBay(booking.bay || defaultBay);
    } else if (open) {
      setEmail(presetEmail || "");
      setName("");
      if (presetEmail) {
        const m = customers.find((c) => c.email === presetEmail);
        if (m) setName(m.name);
      }
      setDate(tds());
      setStartTime("10:00");
      setEndTime("11:00");
      setBay(defaultBay);
    }
  }, [open, booking, presetEmail, customers]);

  function handleEmailChange(v) {
    setEmail(v);
    const m = customers.find((c) => c.email === v);
    if (m) setName(m.name);
  }

  async function handleSave() {
    if (!email || !date || !startTime || !endTime) return;
    setSaving(true);
    const sD = new Date(`${date}T${startTime}:00`);
    const eD = new Date(`${date}T${endTime}:00`);
    await onSave({
      customer_email: email.trim().toLowerCase(),
      customer_name: name.trim() || email.trim(),
      booking_start: sD.toISOString(),
      booking_end: eD.toISOString(),
      duration_hours: Math.round(Math.max(0, (eD - sD) / 3600000) * 100) / 100,
      bay,
      booking_status: "Confirmed",
      ...(isEdit ? {} : { booking_id: `manual_${Date.now()}` }),
    });
    setSaving(false);
  }

  const duration = startTime && endTime && date
    ? Math.max(0, (new Date(`${date}T${endTime}:00`) - new Date(`${date}T${startTime}:00`)) / 3600000).toFixed(1)
    : null;

  return (
    <Modal open={open} onClose={onClose}>
      <h2>{isEdit ? "Edit Booking" : "Add Booking"}</h2>
      <div className="mf">
        <label>Email</label>
        {isEdit ? (
          <input value={email} disabled style={{ opacity: 0.5 }} />
        ) : (
          <>
            <input
              type="email"
              list="cl"
              value={email}
              onChange={(e) => handleEmailChange(e.target.value)}
              placeholder="email"
            />
            <datalist id="cl">
              {customers.map((c) => (
                <option key={c.email} value={c.email}>{c.name}</option>
              ))}
            </datalist>
          </>
        )}
      </div>
      <div className="mf">
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
      </div>
      <div className="mf">
        <label>Date</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <div className="mf" style={{ flex: 1 }}>
          <label>Start</label>
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </div>
        <div className="mf" style={{ flex: 1 }}>
          <label>End</label>
          <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </div>
      </div>
      {duration && (
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 10 }}>
          Duration: {duration}h
        </div>
      )}
      <div className="mf">
        <label>{bayLabel}</label>
        <select value={bay} onChange={(e) => setBay(e.target.value)}>
          {BAYS.map((b) => <option key={b}>{b}</option>)}
        </select>
      </div>
      <div className="macts">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={handleSave} disabled={saving || !email || !date}>
          {saving ? "..." : isEdit ? "Save" : "Add"}
        </button>
      </div>
    </Modal>
  );
}
