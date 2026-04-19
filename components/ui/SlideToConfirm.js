import { useEffect, useRef, useState } from "react";

// Slide-to-confirm interaction. The thumb starts at the left edge of a
// pill track; the user drags it to the right to fire onConfirm. On
// release before the threshold (default 80% of the track), the thumb
// springs back. Adds intentional friction over a single tap so high-
// stakes actions (extending a live booking, etc.) don't fire from
// accidental touches.
//
// Pointer events handle mouse + touch + pen uniformly. `touch-action:
// none` on the thumb tells the browser not to hijack horizontal drags
// for scroll/zoom gestures, so the slide tracks the finger cleanly on
// mobile.
//
// Props:
//   label       string  — what shows on the thumb (e.g. "+15 min")
//   hint        string  — center-track copy ("Slide to extend")
//   busy        bool    — disables the slider + replaces hint with busyLabel
//   busyLabel   string  — shown center-track while busy ("Extending…")
//   onConfirm   func    — fired once the slide passes the threshold
//   threshold   number  — fraction of max-offset that triggers (default 0.85)
export default function SlideToConfirm({
  label = "Slide",
  hint = "Slide to confirm",
  busy = false,
  busyLabel = "Working…",
  onConfirm,
  threshold = 0.85,
}) {
  const trackRef = useRef(null);
  const thumbRef = useRef(null);
  const [trackW, setTrackW] = useState(0);
  const [thumbW, setThumbW] = useState(0);
  const [pos, setPos] = useState(0);              // px offset of the thumb
  const [dragging, setDragging] = useState(false);
  const drag = useRef({ active: false, startX: 0, startPos: 0 });

  // Measure the track + thumb so we can clamp drag distance to the
  // track's interior. Re-measure on resize so a rotation / window
  // resize doesn't strand the thumb beyond the new bounds.
  useEffect(() => {
    function measure() {
      if (trackRef.current) setTrackW(trackRef.current.offsetWidth);
      if (thumbRef.current) setThumbW(thumbRef.current.offsetWidth);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [busy, label]);

  // Reserve 4px on each side of the thumb for breathing room.
  const maxOffset = Math.max(0, trackW - thumbW - 8);

  // Reset to the start position when the parent's busy clears (action
  // finished). Until then, leave the thumb wherever the confirm
  // handler parked it (typically all the way to the right).
  useEffect(() => {
    if (!busy) setPos(0);
  }, [busy]);

  function onPointerDown(e) {
    if (busy) return;
    e.preventDefault();
    drag.current = { active: true, startX: e.clientX, startPos: pos };
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e) {
    if (!drag.current.active) return;
    const dx = e.clientX - drag.current.startX;
    const next = Math.min(maxOffset, Math.max(0, drag.current.startPos + dx));
    setPos(next);
  }
  function onPointerEnd(e) {
    if (!drag.current.active) return;
    drag.current.active = false;
    setDragging(false);
    const ratio = maxOffset > 0 ? pos / maxOffset : 0;
    if (ratio >= threshold) {
      // Snap to the end and fire. Parent flips busy true; the busy
      // useEffect will spring back to 0 when it clears.
      setPos(maxOffset);
      onConfirm?.();
    } else {
      setPos(0);
    }
  }

  // Fill width tracks the thumb so the colored portion of the pill
  // grows with the drag. +thumbW so the fill always extends to the
  // right edge of the thumb (visually "the part you've covered").
  const fillWidth = trackW > 0 ? Math.min(trackW, pos + thumbW + 8) : 0;
  const transition = dragging ? "none" : "transform 0.25s cubic-bezier(.2,.8,.2,1), width 0.25s cubic-bezier(.2,.8,.2,1)";

  return (
    <div
      ref={trackRef}
      className={`slide-confirm ${busy ? "busy" : ""}`}
      role="group"
      aria-label={hint}
    >
      <div
        className="slide-confirm-fill"
        style={{ width: `${fillWidth}px`, transition }}
      />
      <span
        className="slide-confirm-hint"
        // Fade out as the thumb approaches the right so it doesn't
        // visually fight with the moving label.
        style={{ opacity: maxOffset > 0 ? Math.max(0.25, 1 - (pos / maxOffset)) : 1 }}
      >
        {busy ? busyLabel : hint}
      </span>
      <button
        ref={thumbRef}
        type="button"
        className="slide-confirm-thumb"
        style={{ transform: `translateX(${pos}px)`, transition }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        disabled={busy}
        aria-label={hint}
      >
        <span className="slide-confirm-label">{busy ? "…" : label}</span>
        {!busy && <span className="slide-confirm-arrow" aria-hidden="true">›››</span>}
      </button>
    </div>
  );
}
