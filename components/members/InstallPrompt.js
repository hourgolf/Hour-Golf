import { useState, useEffect } from "react";
import { useBranding } from "../../hooks/useBranding";

// Detect if the page is running as an installed PWA. Checks every
// standalone-ish display mode plus iOS's legacy navigator.standalone
// flag plus the Android TWA referrer. Any match = treat as installed.
function isStandalone() {
  if (typeof window === "undefined") return false;
  const modes = ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"];
  for (const m of modes) {
    try {
      if (window.matchMedia(`(display-mode: ${m})`).matches) return true;
    } catch { /* older browsers */ }
  }
  if (window.navigator && window.navigator.standalone === true) return true;
  if (typeof document !== "undefined" && document.referrer.startsWith("android-app://")) return true;
  return false;
}

function getOS() {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  if (/android/i.test(ua)) return "android";
  return "desktop";
}

// Dismissal persists for 30 days via localStorage. sessionStorage was
// too aggressive (dies with the tab) AND too sticky (one dismissal
// in a still-open tab hides the banner even after uninstall, which
// made the prompt feel inverted on reopen). 30 days gives a
// "don't nag me this month, but remind me eventually" cadence.
const DISMISS_KEY = "hg-install-dismissed-until";
const DISMISS_DAYS = 30;

function isDismissedActive() {
  if (typeof localStorage === "undefined") return false;
  try {
    const until = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return until > Date.now();
  } catch { return false; }
}

function setDismissedNow() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 24 * 3600 * 1000));
  } catch { /* quota / private mode */ }
  // Best-effort: clear any lingering sessionStorage flag from older
  // builds so state doesn't get carried forward.
  try { sessionStorage.removeItem("hg-install-dismissed"); } catch {}
}

export default function InstallPrompt({ variant = "banner" }) {
  const [show, setShow] = useState(false);
  const [os, setOS] = useState("unknown");
  const [dismissed, setDismissed] = useState(false);
  const branding = useBranding();
  const appName = branding?.app_name || "app";

  useEffect(() => {
    // Don't show if already installed.
    if (isStandalone()) return;
    // Respect a recent dismissal.
    if (isDismissedActive()) return;
    setOS(getOS());
    setShow(true);
  }, []);

  function dismiss() {
    setDismissed(true);
    setShow(false);
    setDismissedNow();
  }

  if (!show || dismissed) return null;

  // Compact version for login page
  if (variant === "login") {
    return (
      <div style={{
        background: "var(--primary, #4C8D73)", borderRadius: 12, padding: "14px 18px",
        marginBottom: 20, color: "#EDF3E3", fontSize: 13, lineHeight: 1.5,
        position: "relative",
      }}>
        <button onClick={dismiss} style={{
          position: "absolute", top: 8, right: 10, background: "none", border: "none",
          color: "rgba(237,243,227,0.6)", fontSize: 16, cursor: "pointer", lineHeight: 1,
        }}>&times;</button>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>
          Get the {appName} App
        </div>
        {os === "ios" ? (
          <span>
            Tap <strong>Share</strong> <span style={{ fontSize: 16 }}>&#8682;</span> then <strong>&ldquo;Add to Home Screen&rdquo;</strong> for the best experience.
          </span>
        ) : os === "android" ? (
          <span>
            Tap <strong>Menu</strong> <span style={{ fontSize: 14 }}>(&#8942;)</span> then <strong>&ldquo;Install app&rdquo;</strong> or <strong>&ldquo;Add to Home Screen&rdquo;</strong>.
          </span>
        ) : (
          <span>
            Install this app from your browser for quick access from your home screen.
          </span>
        )}
      </div>
    );
  }

  // Dashboard banner
  return (
    <div style={{
      background: "var(--surface, #fff)", border: "1.5px solid var(--primary, #4C8D73)",
      borderRadius: "var(--radius, 15px)", padding: "14px 18px", marginBottom: 20,
      display: "flex", alignItems: "center", gap: 14, position: "relative",
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 10, background: "var(--primary, #4C8D73)",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        <img src="/icons/icon-96x96.png" alt="" style={{ width: 32, height: 32, borderRadius: 6 }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text, #35443B)", marginBottom: 2 }}>
          Add {appName} to your Home Screen
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted, #8BB5A0)", lineHeight: 1.4 }}>
          {os === "ios" ? (
            <>Tap <strong>Share</strong> <span style={{ fontSize: 14 }}>&#8682;</span> &rarr; <strong>&ldquo;Add to Home Screen&rdquo;</strong></>
          ) : os === "android" ? (
            <>Tap <strong>&#8942; Menu</strong> &rarr; <strong>&ldquo;Install app&rdquo;</strong></>
          ) : (
            <>Install from your browser for quick access</>
          )}
        </div>
      </div>
      <button onClick={dismiss} style={{
        background: "none", border: "none", color: "var(--text-muted, #8BB5A0)",
        fontSize: 20, cursor: "pointer", lineHeight: 1, padding: "0 2px", flexShrink: 0,
      }}>&times;</button>
    </div>
  );
}
