import { useState, useEffect, useCallback } from "react";
import { THEMES } from "../lib/constants";

const DEFAULTS = {
  theme: "augusta",
  customColor: "",
  font: "'IBM Plex Mono', monospace",
  fontSize: 13,
  dark: false,
  density: "comfortable",
  logoUrl: "",
  logoScale: 36,
  showLogo: true,
  showTitle: true,
  showSubtitle: true,
  headerBtnSize: 11,
};

function loadSettings() {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem("hg-settings");
    if (!raw) return DEFAULTS;
    const s = JSON.parse(raw);
    return {
      theme: s.theme || DEFAULTS.theme,
      customColor: s.customColor || DEFAULTS.customColor,
      font: s.font || DEFAULTS.font,
      fontSize: s.fontSize || DEFAULTS.fontSize,
      dark: !!s.dark,
      density: s.density || DEFAULTS.density,
      logoUrl: s.logoUrl || DEFAULTS.logoUrl,
      logoScale: s.logoScale || DEFAULTS.logoScale,
      showLogo: s.showLogo !== undefined ? s.showLogo : true,
      showTitle: s.showTitle !== undefined ? s.showTitle : true,
      showSubtitle: s.showSubtitle !== undefined ? s.showSubtitle : true,
      headerBtnSize: s.headerBtnSize || DEFAULTS.headerBtnSize,
    };
  } catch {
    return DEFAULTS;
  }
}

function saveSettings(s) {
  if (typeof window !== "undefined") {
    localStorage.setItem("hg-settings", JSON.stringify(s));
  }
}

export function useSettings() {
  const [settings, setSettings] = useState(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);

  // Load from localStorage only after client-side mount
  useEffect(() => {
    setSettings(loadSettings());
    setHydrated(true);
  }, []);

  // Apply settings whenever they change (but only after hydration)
  useEffect(() => {
    if (!hydrated) return;
    saveSettings(settings);
    const primaryColor = settings.customColor || (THEMES[settings.theme] || THEMES.augusta).primary;
    document.documentElement.style.setProperty("--primary", primaryColor);
    document.documentElement.style.setProperty("--primary-light", primaryColor + "cc");
    document.documentElement.style.setProperty("--font", settings.font);
    document.documentElement.style.setProperty("--font-size", settings.fontSize + "px");
    document.documentElement.style.setProperty("--hdr-btn-size", (settings.headerBtnSize || 11) + "px");
    document.body.style.fontFamily = settings.font;
    document.body.style.fontSize = settings.fontSize + "px";
    document.documentElement.setAttribute("data-theme", settings.dark ? "dark" : "light");
    document.documentElement.setAttribute("data-density", settings.density);
  }, [settings, hydrated]);

  const updateSetting = useCallback((key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  return { settings, setSettings, updateSetting };
}
