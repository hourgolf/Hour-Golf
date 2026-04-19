import { useEffect, useState } from "react";

// Surfaces a small "New version available" banner when a fresh service
// worker has installed and is waiting to take over. Wired up from
// pages/_app.js so it shows on every route, including the installed PWA
// (which is exactly the audience this is for — installed members were
// stuck on stale cached shells until they manually closed + reopened).
//
// Lifecycle:
//   1. _app.js registers /sw.js and listens for `updatefound` on the
//      registration. When a new SW reaches the `installed` state AND
//      there's already an active controller, it dispatches a
//      window-level "hg:sw-update-available" event.
//   2. This component listens for that event and flips into the
//      "show" state.
//   3. On click, it tells the waiting SW to skipWaiting (the existing
//      sw.js already calls skipWaiting in its install handler, so this
//      is belt-and-suspenders) and reloads the page so the new SW
//      takes over cleanly.
export default function UpdateAvailableBanner() {
  const [show, setShow] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState(null);

  useEffect(() => {
    function onUpdate(e) {
      setWaitingWorker(e.detail?.worker || null);
      setShow(true);
    }
    window.addEventListener("hg:sw-update-available", onUpdate);
    return () => window.removeEventListener("hg:sw-update-available", onUpdate);
  }, []);

  if (!show) return null;

  function reload() {
    try {
      // The current sw.js already calls skipWaiting() in its install
      // handler, so the new worker activates the moment it finishes
      // installing — by the time the banner appears, it's typically
      // already the controller. Sending the message anyway is a no-op
      // in that case but covers any future SW that doesn't auto-skip.
      if (waitingWorker && waitingWorker.postMessage) {
        waitingWorker.postMessage({ type: "SKIP_WAITING" });
      }
    } catch { /* ignore */ }
    window.location.reload();
  }

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        // Top-of-screen so it doesn't collide with the bottom-stacked
        // book + help FABs (which sit at the right edge from 16-148px
        // off the bottom). Top placement also reads as more urgent for
        // a "reload to update" prompt.
        position: "fixed",
        left: 16,
        right: 16,
        top: "calc(12px + env(safe-area-inset-top, 0px))",
        zIndex: 9500,
        maxWidth: 480,
        margin: "0 auto",
        background: "var(--text, #35443B)",
        color: "var(--bg, #EDF3E3)",
        borderRadius: 14,
        padding: "12px 14px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
        fontFamily: "var(--font-body, system-ui, sans-serif)",
        fontSize: 14,
      }}
    >
      <div style={{ flex: 1, minWidth: 0, lineHeight: 1.35 }}>
        <strong style={{ fontFamily: "var(--font-display, inherit)", display: "block" }}>
          New version available
        </strong>
        <span style={{ opacity: 0.85, fontSize: 12 }}>
          Reload to get the latest features.
        </span>
      </div>
      <button
        type="button"
        onClick={reload}
        style={{
          padding: "8px 14px",
          borderRadius: 999,
          border: "none",
          background: "var(--primary, #4C8D73)",
          color: "var(--bg, #EDF3E3)",
          fontFamily: "var(--font-display, inherit)",
          fontSize: 12,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        Reload
      </button>
    </div>
  );
}
