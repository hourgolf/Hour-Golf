import { useEffect, useState } from "react";

// Synchronous client read of the tenant's feature flags.
//
// _document.js injects the features object as window.__TENANT_FEATURES__
// on the SSR response, so mounting a component that calls this hook
// doesn't cause a flash of "feature disabled" before the real answer
// arrives. If the global is missing (older tab, transient error), the
// hook returns an open-by-default object — consistent with the
// server-side fail-open policy in lib/tenant-features.js.
//
// Shape:
//   const { features, isEnabled } = useTenantFeatures();
//   if (isEnabled("pro_shop")) { ... }

const KNOWN_KEYS = [
  "bookings",
  "pro_shop",
  "loyalty",
  "events",
  "punch_passes",
  "subscriptions",
  "stripe_enabled",
  "email_notifications",
  "access_codes",
];

function defaultFeatures() {
  const out = {};
  for (const k of KNOWN_KEYS) out[k] = true;
  return out;
}

function readInitial() {
  if (typeof window === "undefined") return defaultFeatures();
  const injected = window.__TENANT_FEATURES__;
  if (!injected || typeof injected !== "object") return defaultFeatures();
  return { ...defaultFeatures(), ...injected };
}

export function useTenantFeatures() {
  const [features, setFeatures] = useState(() => readInitial());

  // If a later render injects / updates the global (unlikely but cheap
  // to support), pick it up. Primarily a belt-and-suspenders.
  useEffect(() => {
    const handler = () => setFeatures(readInitial());
    if (typeof window !== "undefined") {
      window.addEventListener("tenant-features-updated", handler);
      return () => window.removeEventListener("tenant-features-updated", handler);
    }
  }, []);

  function isEnabled(key) {
    if (!features || typeof features !== "object") return true;
    if (!(key in features)) return true;
    return features[key] !== false;
  }

  return { features, isEnabled };
}
