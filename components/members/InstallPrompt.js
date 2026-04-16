import { useState, useEffect } from "react";

function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function getOS() {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  if (/android/i.test(ua)) return "android";
  return "desktop";
}

export default function InstallPrompt({ variant = "banner" }) {
  const [show, setShow] = useState(false);
  const [os, setOS] = useState("unknown");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Don't show if already installed as app
    if (isStandalone()) return;
    // Don't show if previously dismissed this session
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem("hg-install-dismissed")) return;
    setOS(getOS());
    setShow(true);
  }, []);

  function dismiss() {
    setDismissed(true);
    setShow(false);
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem("hg-install-dismissed", "1");
    }
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
          Get the Hour Golf App
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
          Add Hour Golf to your Home Screen
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
