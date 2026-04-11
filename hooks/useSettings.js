import { useState, useEffect, useCallback, useRef } from "react";
import { THEMES } from "../lib/constants";
import { supa, supaPost } from "../lib/supabase";

const DEFAULTS = {
  theme: "augusta",
  customColor: "",
  font: "'IBM Plex Mono', monospace",
  fontSize: 16,
  dark: false,
  density: "comfortable",
  logoUrl: "",
  logoScale: 36,
  showLogo: true,
  showTitle: true,
  showSubtitle: true,
  headerBtnSize: 16,
};

// Merge a stored object with defaults so missing keys never crash the UI.
function normalize(s) {
  if (!s || typeof s !== "object") return DEFAULTS;
  return {
    theme: s.theme || DEFAULTS.theme,
    customColor: s.customColor || DEFAULTS.customColor,
    font: s.font || DEFAULTS.font,
    fontSize: DEFAULTS.fontSize, // intentionally fixed
    dark: !!s.dark,
    density: s.density || DEFAULTS.density,
    logoUrl: s.logoUrl || DEFAULTS.logoUrl,
    logoScale: s.logoScale || DEFAULTS.logoScale,
    showLogo: s.showLogo !== undefined ? s.showLogo : true,
    showTitle: s.showTitle !== undefined ? s.showTitle : true,
    showSubtitle: s.showSubtitle !== undefined ? s.showSubtitle : true,
    headerBtnSize: DEFAULTS.headerBtnSize, // intentionally fixed
  };
}

function loadLocal() {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem("hg-settings");
    if (!raw) return DEFAULTS;
    return normalize(JSON.parse(raw));
  } catch {
    return DEFAULTS;
  }
}

function saveLocal(s) {
  if (typeof window !== "undefined") {
    try { localStorage.setItem("hg-settings", JSON.stringify(s)); } catch {}
  }
}

export function useSettings({ user, apiKey, connected } = {}) {
  const [settings, setSettings] = useState(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);
  const cloudFetchedRef = useRef(false);
  const saveTimerRef = useRef(null);

  // 1) Local instant-paint hydration
  useEffect(() => {
    setSettings(loadLocal());
    setHydrated(true);
  }, []);

  // 2) Cloud fetch once auth is ready. Cloud overrides local if a row exists.
  useEffect(() => {
    if (!connected || !apiKey || !user?.id) return;
    if (cloudFetchedRef.current) return;
    cloudFetchedRef.current = true;
    (async () => {
      try {
        const rows = await supa(
          apiKey,
          "app_settings",
          `?user_id=eq.${user.id}&select=settings`
        );
        if (Array.isArray(rows) && rows.length > 0 && rows[0]?.settings) {
          const merged = normalize(rows[0].settings);
          setSettings(merged);
          saveLocal(merged);
        }
      } catch (e) {
        // Cloud fetch failed; keep local copy.
        console.warn("Cloud settings fetch failed:", e?.message || e);
      }
    })();
  }, [connected, apiKey, user?.id]);

  // Reset the cloud-fetch guard on logout so the next login re-pulls.
  useEffect(() => {
    if (!connected) cloudFetchedRef.current = false;
  }, [connected]);

  // 3) Apply visual side-effects + persist locally on every change.
  useEffect(() => {
    if (!hydrated) return;
    saveLocal(settings);
    const primaryColor = settings.customColor || (THEMES[settings.theme] || THEMES.augusta).primary;
    document.documentElement.style.setProperty("--primary", primaryColor);
    document.documentElement.style.setProperty("--primary-light", primaryColor + "cc");
    document.documentElement.style.setProperty("--font", settings.font);
    document.documentElement.style.setProperty("--font-size", settings.fontSize + "px");
    document.documentElement.style.setProperty("--hdr-btn-size", (settings.headerBtnSize || 16) + "px");
    document.body.style.fontFamily = settings.font;
    document.body.style.fontSize = settings.fontSize + "px";
    document.documentElement.setAttribute("data-theme", settings.dark ? "dark" : "light");
    document.documentElement.setAttribute("data-density", settings.density);
  }, [settings, hydrated]);

  // 4) Debounced cloud sync (only after the cloud copy has been pulled, so
  // we don't overwrite a remote row with a default-filled local one).
  useEffect(() => {
    if (!hydrated) return;
    if (!connected || !apiKey || !user?.id) return;
    if (!cloudFetchedRef.current) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await supaPost(apiKey, "app_settings", {
          user_id: user.id,
          settings,
          updated_at: new Date().toISOString(),
        });
      } catch (e) {
        console.warn("Cloud settings save failed:", e?.message || e);
      }
    }, 800);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [settings, hydrated, connected, apiKey, user?.id]);

  const updateSetting = useCallback((key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  return { settings, setSettings, updateSetting };
}
