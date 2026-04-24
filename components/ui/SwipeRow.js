import { useEffect, useRef, useState } from "react";
import { useIsMobile } from "../../hooks/useIsMobile";

// Swipe-to-action wrapper for booking rows. Mobile-only; on desktop
// it's a transparent passthrough.
//
// Gesture:
//   • Swipe LEFT to reveal red Cancel action  (iOS Mail convention).
//   • Swipe RIGHT to reveal blue Edit action.
//   • Threshold ±THRESHOLD px on release fires the action; below
//     threshold snaps back. Inline buttons remain in the row so swipe
//     is purely additive — never the only path to an action.
//
// Touch arbitration: capture initial x/y; only hijack the gesture
// once horizontal delta clearly exceeds vertical. Otherwise release
// to the browser so vertical scroll still works inside long lists.
export default function SwipeRow({
  onSwipeLeft,
  onSwipeRight,
  leftLabel = "Edit",
  rightLabel = "Cancel",
  disabled = false,
  className = "",
  children,
}) {
  const isMobile = useIsMobile();
  const ref = useRef(null);
  const stateRef = useRef({ startX: 0, startY: 0, active: false, dragging: false });
  const [delta, setDelta] = useState(0);
  const [animating, setAnimating] = useState(false);

  const enabled = isMobile && !disabled && (onSwipeLeft || onSwipeRight);

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;

    const THRESHOLD = 80;
    const MAX = 120;

    function onTouchStart(e) {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      stateRef.current = { startX: t.clientX, startY: t.clientY, active: true, dragging: false };
      setAnimating(false);
    }

    function onTouchMove(e) {
      const st = stateRef.current;
      if (!st.active) return;
      const t = e.touches[0];
      const dx = t.clientX - st.startX;
      const dy = t.clientY - st.startY;
      if (!st.dragging) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dy) > Math.abs(dx)) {
          stateRef.current.active = false;
          return;
        }
        stateRef.current.dragging = true;
      }
      // Block direction without an action handler — clamp to 0 on
      // that side so the user gets feedback that nothing's there.
      let next = dx;
      if (next > 0 && !onSwipeRight) next = 0;
      if (next < 0 && !onSwipeLeft) next = 0;
      next = Math.max(-MAX, Math.min(MAX, next));
      setDelta(next);
    }

    function onTouchEnd() {
      const st = stateRef.current;
      stateRef.current = { startX: 0, startY: 0, active: false, dragging: false };
      const d = deltaRef.current;
      setAnimating(true);
      if (d <= -THRESHOLD && onSwipeLeft) {
        setDelta(0);
        // Defer the action one tick so the snap-back transition
        // starts before the React state re-render of the parent.
        setTimeout(() => onSwipeLeft(), 0);
      } else if (d >= THRESHOLD && onSwipeRight) {
        setDelta(0);
        setTimeout(() => onSwipeRight(), 0);
      } else {
        setDelta(0);
      }
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [enabled, onSwipeLeft, onSwipeRight]);

  // Mirror delta in a ref so touchend reads the live value.
  const deltaRef = useRef(0);
  useEffect(() => { deltaRef.current = delta; }, [delta]);

  if (!enabled) {
    return <>{children}</>;
  }

  const showLeftBg = delta > 0 && onSwipeRight;   // pulling right reveals left-side bg
  const showRightBg = delta < 0 && onSwipeLeft;  // pulling left reveals right-side bg
  const leftActive = delta >= 80;
  const rightActive = delta <= -80;

  return (
    <div ref={ref} className={`swipe-row ${className}`.trim()}>
      {showLeftBg && (
        <div className={`swipe-row-bg swipe-row-bg-edit${leftActive ? " active" : ""}`} aria-hidden="true">
          <span className="swipe-row-bg-label">{leftLabel}</span>
        </div>
      )}
      {showRightBg && (
        <div className={`swipe-row-bg swipe-row-bg-cancel${rightActive ? " active" : ""}`} aria-hidden="true">
          <span className="swipe-row-bg-label">{rightLabel}</span>
        </div>
      )}
      <div
        className="swipe-row-fg"
        style={{
          transform: `translateX(${delta}px)`,
          transition: animating ? "transform 220ms ease" : "none",
        }}
      >
        {children}
      </div>
    </div>
  );
}
