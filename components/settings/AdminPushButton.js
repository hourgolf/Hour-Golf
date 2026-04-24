import { useEffect, useState } from "react";
import { pushSupported, getExistingSubscription, enablePush, disablePush } from "../../lib/admin-push-client";

// Toggle for admin push notifications. Lives next to the Install
// button on Settings → Account. Three states:
//   - unsupported: short hint + nothing actionable
//   - off:         "Enable notifications" button
//   - on:          "Disable notifications" + device hint
//
// iOS quirk: push only works on an installed PWA. If we detect
// standalone=false on iOS, we route the user to install first.

export default function AdminPushButton({ apiKey }) {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] = useState("default");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [standalone, setStandalone] = useState(true);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    setSupported(pushSupported());
    if (typeof window !== "undefined" && "Notification" in window) {
      setPermission(Notification.permission);
    }
    if (typeof window !== "undefined") {
      setStandalone(
        window.matchMedia?.("(display-mode: standalone)").matches
        || window.navigator.standalone === true
      );
      const ua = String(window.navigator.userAgent || "");
      setIsIos(/iPhone|iPad|iPod/i.test(ua) && !/CriOS|FxiOS/i.test(ua));
    }
    (async () => {
      const existing = await getExistingSubscription();
      setSubscribed(!!existing);
    })();
  }, []);

  if (!supported) {
    return (
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
        Notifications aren&rsquo;t supported on this browser.
      </div>
    );
  }

  // iOS-specific gate: Safari only supports Web Push inside an
  // installed PWA. Outside standalone mode, the permission request
  // silently fails on iOS — better to explain upfront.
  if (isIos && !standalone) {
    return (
      <div style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 340 }}>
        On iPhone, notifications only work after you install HGC Office to your Home Screen. Install first (see the card above), then come back here.
      </div>
    );
  }

  if (permission === "denied") {
    return (
      <div style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 340 }}>
        Notifications are blocked for this site. Enable them from your browser&rsquo;s site settings and reload.
      </div>
    );
  }

  async function onEnable() {
    setBusy(true);
    setErr(null);
    try {
      await enablePush(apiKey);
      setSubscribed(true);
      setPermission("granted");
    } catch (e) {
      setErr(e.message || "Couldn't enable notifications");
    }
    setBusy(false);
  }

  async function onDisable() {
    setBusy(true);
    setErr(null);
    try {
      await disablePush(apiKey);
      setSubscribed(false);
    } catch (e) {
      setErr(e.message || "Couldn't disable");
    }
    setBusy(false);
  }

  return (
    <div>
      {subscribed ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "var(--primary)" }}>
            ✓ Notifications on for this device.
          </span>
          <button
            className="btn"
            style={{ padding: "8px 14px", fontSize: 12 }}
            disabled={busy}
            onClick={onDisable}
          >
            {busy ? "…" : "Disable"}
          </button>
        </div>
      ) : (
        <button
          className="btn primary"
          style={{ padding: "10px 16px", fontSize: 13 }}
          disabled={busy}
          onClick={onEnable}
        >
          {busy ? "Enabling…" : "🔔 Enable notifications"}
        </button>
      )}
      {err && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--danger, #C92F1F)" }}>{err}</div>
      )}
    </div>
  );
}
