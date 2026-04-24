import { useEffect, useState } from "react";

// "Install HGC Office" button for Settings → Account. Listens for the
// browser's beforeinstallprompt event and surfaces it as a tap-to-
// install action. When already installed (standalone display mode)
// the button hides itself so it doesn't linger as dead UI.
//
// iOS quirk: Safari on iOS doesn't fire beforeinstallprompt. We
// detect iOS + non-standalone + pro_shop/admin context and show a
// short "Add to Home Screen via Share menu" hint instead of a button.

export default function AdminInstallButton() {
  const [deferred, setDeferred] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Already installed? (opened from the home screen icon → standalone)
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches
      || window.navigator.standalone === true;
    setInstalled(standalone);

    const ua = String(window.navigator.userAgent || "");
    setIsIos(/iPhone|iPad|iPod/i.test(ua) && !/CriOS|FxiOS/i.test(ua));

    function onBeforeInstall(e) {
      e.preventDefault();
      setDeferred(e);
    }
    function onInstalled() {
      setInstalled(true);
      setDeferred(null);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) {
    return (
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
        ✓ Installed. You&rsquo;re already running HGC Office as an app.
      </div>
    );
  }

  async function doInstall() {
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch {}
    setDeferred(null);
  }

  // Chrome/Edge/Android: real install button.
  if (deferred) {
    return (
      <button
        className="btn primary"
        style={{ padding: "10px 16px", fontSize: 13 }}
        onClick={doInstall}
      >
        📲 Install HGC Office
      </button>
    );
  }

  // iOS Safari: no native prompt — surface the Share-menu hint once.
  if (isIos && !hintDismissed) {
    return (
      <div style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 320 }}>
        On iPhone: tap <strong>Share</strong> → <strong>Add to Home Screen</strong> to install HGC Office.
        <button
          onClick={() => setHintDismissed(true)}
          style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 11, marginLeft: 6, textDecoration: "underline" }}
        >
          dismiss
        </button>
      </div>
    );
  }

  // Other browsers (desktop Safari, Firefox): no installable signal.
  return null;
}
