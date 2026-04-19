import { useEffect } from "react";
import "../styles/globals.css";
import "../styles/platform.css";
import UpdateAvailableBanner from "../components/UpdateAvailableBanner";

export default function App({ Component, pageProps }) {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;

    navigator.serviceWorker.register("/sw.js").then((reg) => {
      if (cancelled) return;

      // Detect a new SW installing while another one is already
      // controlling the page — that's an update, not a first install.
      // Dispatch a window event so <UpdateAvailableBanner /> can show.
      function trackInstalling(worker) {
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            window.dispatchEvent(
              new CustomEvent("hg:sw-update-available", { detail: { worker } })
            );
          }
        });
      }

      // If a worker was already installing when we registered.
      if (reg.installing) trackInstalling(reg.installing);
      // If one's already waiting (page loaded after install completed
      // but before the user reloaded) — surface the banner immediately.
      if (reg.waiting && navigator.serviceWorker.controller) {
        window.dispatchEvent(
          new CustomEvent("hg:sw-update-available", { detail: { worker: reg.waiting } })
        );
      }
      // Future installs.
      reg.addEventListener("updatefound", () => trackInstalling(reg.installing));

      // Poll for updates every 30 minutes so a long-lived installed PWA
      // session catches deploys without the member needing to reopen
      // the app. Cheap — just a HEAD-equivalent on /sw.js.
      const intervalId = setInterval(() => {
        reg.update().catch(() => {});
      }, 30 * 60 * 1000);
      // Best-effort: also re-check whenever the tab regains focus —
      // covers the common "open the app from home screen after a few
      // hours" case more aggressively than the 30-min poll alone.
      function onVisible() {
        if (document.visibilityState === "visible") {
          reg.update().catch(() => {});
        }
      }
      document.addEventListener("visibilitychange", onVisible);

      // Stash cleanup on the registration so a hot-reload during dev
      // doesn't pile up listeners. Best-effort.
      reg._hgCleanup = () => {
        clearInterval(intervalId);
        document.removeEventListener("visibilitychange", onVisible);
      };
    }).catch(() => {});

    return () => {
      cancelled = true;
      if (typeof navigator !== "undefined" && navigator.serviceWorker?.getRegistration) {
        navigator.serviceWorker.getRegistration().then((reg) => {
          if (reg && typeof reg._hgCleanup === "function") reg._hgCleanup();
        }).catch(() => {});
      }
    };
  }, []);

  return (
    <>
      <Component {...pageProps} />
      <UpdateAvailableBanner />
    </>
  );
}
