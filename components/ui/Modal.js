import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Renders into document.body via a portal so the modal escapes whatever
// stacking context its caller lives in. This matters because the sticky
// member header (.mem-stickytop, z-index 100 inside .mem-layout) was
// painting *over* the modal — modal-bg's z-index: 1000 only outranks
// siblings inside the same stacking context, and the portal moves it
// to the top of the tree where its z-index is global.
//
// SSR-safe: defers portal mount until after first render so document
// is available. Unmounting closes cleanly via the existing onClose.
export default function Modal({ open, onClose, children }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Lock body scroll while open so the page underneath doesn't drift
  // when a member uses two-finger drag inside a long modal.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open || !mounted) return null;

  const node = (
    <div className="modal-bg" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ position: "relative" }}>
        <button
          onClick={onClose}
          style={{
            position: "absolute", top: 12, right: 12, zIndex: 10,
            width: 32, height: 32, borderRadius: "50%",
            border: "none", background: "rgba(53,68,59,0.1)",
            color: "var(--text)", fontSize: 18, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            lineHeight: 1,
          }}
          aria-label="Close"
        >&times;</button>
        {children}
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
