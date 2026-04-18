// Load + persist the platform admin's personal UI preferences.
//
// Usage:
//   const { settings, update, saving } = usePlatformSettings({ apiKey, connected });
//   update("accent", "blue");   // optimistic; debounced save to DB
//
// Keys today:
//   accent            "emerald" | "blue" | "teal" | "amber" | "slate"
//   density           "comfortable" | "compact"
//   sidebarCollapsed  boolean
//
// Applied to <html> as data-accent / data-density / data-sidebar
// attributes so styles/platform.css can react via attribute selectors.
// Rendered instantly from localStorage so there's no color flash on
// page load; the server row is pulled after mount and overrides local
// if it exists.

import { useEffect, useRef, useState, useCallback } from "react";

const STORAGE_KEY = "platform-settings";

const DEFAULTS = {
  accent: "emerald",
  density: "comfortable",
  sidebarCollapsed: false,
};

function normalize(s) {
  if (!s || typeof s !== "object") return { ...DEFAULTS };
  return {
    accent:
      ["emerald", "blue", "teal", "amber", "slate"].includes(s.accent)
        ? s.accent
        : DEFAULTS.accent,
    density: s.density === "compact" ? "compact" : "comfortable",
    sidebarCollapsed: !!s.sidebarCollapsed,
  };
}

function loadLocal() {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalize(JSON.parse(raw)) : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveLocal(s) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {}
}

function applyToDocument(s) {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  html.setAttribute("data-accent", s.accent);
  html.setAttribute("data-density", s.density);
  html.setAttribute("data-sidebar", s.sidebarCollapsed ? "collapsed" : "expanded");
}

export function usePlatformSettings({ apiKey, connected } = {}) {
  const [settings, setSettings] = useState(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const cloudFetchedRef = useRef(false);
  const saveTimerRef = useRef(null);

  // 1) Local instant paint
  useEffect(() => {
    const local = loadLocal();
    setSettings(local);
    applyToDocument(local);
    setHydrated(true);
  }, []);

  // 2) Cloud fetch once authed. If the server has values, they win.
  useEffect(() => {
    if (!connected || !apiKey) return;
    if (cloudFetchedRef.current) return;
    cloudFetchedRef.current = true;
    (async () => {
      try {
        const r = await fetch("/api/platform-settings", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!r.ok) return;
        const d = await r.json();
        if (d.settings && Object.keys(d.settings).length > 0) {
          const merged = normalize({ ...DEFAULTS, ...d.settings });
          setSettings(merged);
          saveLocal(merged);
          applyToDocument(merged);
        }
      } catch {
        /* keep local; log nothing — the console noise isn't useful */
      }
    })();
  }, [connected, apiKey]);

  // 3) Apply visual side-effects on every settings change
  useEffect(() => {
    if (!hydrated) return;
    applyToDocument(settings);
    saveLocal(settings);
  }, [settings, hydrated]);

  // 4) Debounced cloud save. Only after the cloud fetch has landed, so a
  // default-filled local copy doesn't clobber remote on first paint.
  useEffect(() => {
    if (!hydrated) return;
    if (!connected || !apiKey) return;
    if (!cloudFetchedRef.current) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        await fetch("/api/platform-settings", {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ settings }),
        });
      } catch {
        /* ignore — retry on next change */
      } finally {
        setSaving(false);
      }
    }, 600);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [settings, hydrated, connected, apiKey]);

  const update = useCallback((key, value) => {
    setSettings((prev) => normalize({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback(() => {
    setSettings({ ...DEFAULTS });
  }, []);

  return { settings, update, reset, saving };
}

export const PLATFORM_DEFAULTS = DEFAULTS;
