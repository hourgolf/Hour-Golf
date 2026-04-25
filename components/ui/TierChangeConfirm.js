import { useState, useEffect } from "react";
import Modal from "./Modal";

// Tier change confirmation with an opt-in "also re-tier recent
// bookings" checkbox. Only shown when there's actually something
// to consider — the parent gates rendering on (oldTier !== newTier
// && affectedBookings > 0).
//
// Why not extend the generic Confirm component: the checkbox UX is
// specific to this flow, and a one-off modal keeps Confirm simple
// for its many other callers.
export default function TierChangeConfirm({
  open,
  onClose,
  onConfirm,        // (retroactive: boolean) => void
  memberName,
  oldTier,
  newTier,
  affectedBookings, // number of confirmed bookings in the last 60 days
  saving,
}) {
  const [retroactive, setRetroactive] = useState(false);

  // Reset the checkbox each time the modal opens, so a previous
  // tier-change's choice doesn't carry over to the next.
  useEffect(() => {
    if (open) setRetroactive(false);
  }, [open]);

  return (
    <Modal open={open} onClose={onClose}>
      <div className="confirm-box">
        <h2 style={{
          fontSize: 15, letterSpacing: 2, textTransform: "uppercase",
          color: "var(--primary)", marginBottom: 14,
        }}>
          Change tier
        </h2>

        <p style={{ marginBottom: 8 }}>
          Set <strong>{memberName}</strong> from{" "}
          <strong>{oldTier || "Non-Member"}</strong> to{" "}
          <strong>{newTier}</strong>?
        </p>

        {affectedBookings > 0 && (
          <label style={{
            display: "flex", alignItems: "flex-start", gap: 10,
            background: "var(--primary-bg, rgba(76,141,115,0.08))",
            border: "1px solid var(--border, rgba(0,0,0,0.08))",
            borderRadius: "var(--radius, 8px)",
            padding: "12px 14px", margin: "12px 0 16px",
            cursor: "pointer", textAlign: "left",
          }}>
            <input
              type="checkbox"
              checked={retroactive}
              onChange={(e) => setRetroactive(e.target.checked)}
              style={{ marginTop: 3, accentColor: "var(--primary)", flexShrink: 0 }}
            />
            <div style={{ flex: 1, fontSize: 13, lineHeight: 1.45 }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>
                Also re-tier their recent bookings
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                Updates {affectedBookings} confirmed booking{affectedBookings === 1 ? "" : "s"} from
                the last 60 days to <strong>{newTier}</strong>.
                Use this when fixing a data error (e.g. tier was wrong
                at signup) — leave unchecked for a real upgrade/downgrade
                so historical billing snapshots stay accurate.
              </div>
            </div>
          </label>
        )}

        <div className="macts" style={{ justifyContent: "center" }}>
          <button className="btn" onClick={onClose} disabled={saving}>
            Nevermind
          </button>
          <button
            className="btn primary"
            onClick={() => onConfirm(retroactive)}
            disabled={saving}
          >
            {saving ? "Saving…" : retroactive ? `Change tier + re-tier ${affectedBookings}` : "Change tier"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
