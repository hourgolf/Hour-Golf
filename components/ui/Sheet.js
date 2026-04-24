import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Bottom sheet — modelled on Modal.js but slides up from the bottom
// of the viewport. Used by the admin shell to render DetailView over
// the Customers list on mobile so the operator keeps list context.
//
// Render lifecycle: open=true mounts immediately and animates up on
// next RAF; open=false animates down and unmounts after the
// transition completes. Body scroll is locked while open so the
// underlying list doesn't drift when the operator scrolls inside the
// sheet.
//
// Desktop is expected to skip rendering this entirely (caller gates
// on useIsMobile) — there are no desktop styles.
export default function Sheet({ open, onClose, children, ariaLabel = "Detail" }) {
  const [mounted, setMounted] = useState(false);
  const [render, setRender] = useState(false);
  const [enter, setEnter] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;
    if (open) {
      setRender(true);
      // Two RAFs: one to commit the initial transform: translateY(100%),
      // a second to flip enter=true so the transition runs.
      const r1 = requestAnimationFrame(() => {
        const r2 = requestAnimationFrame(() => setEnter(true));
        cancelHandle.r2 = r2;
      });
      const cancelHandle = { r1, r2: null };
      return () => {
        cancelAnimationFrame(cancelHandle.r1);
        if (cancelHandle.r2) cancelAnimationFrame(cancelHandle.r2);
      };
    } else {
      setEnter(false);
      const t = setTimeout(() => setRender(false), 260);
      return () => clearTimeout(t);
    }
  }, [open, mounted]);

  useEffect(() => {
    if (!render) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [render]);

  // ESC closes — keyboard parity with Modal.
  useEffect(() => {
    if (!open) return;
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted || !render) return null;

  const node = (
    <div
      className={`sheet-bg${enter ? " open" : ""}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <div className={`sheet${enter ? " open" : ""}`}>
        <div className="sheet-handle" aria-hidden="true">
          <span className="sheet-handle-bar" />
        </div>
        <button
          type="button"
          className="sheet-close"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
