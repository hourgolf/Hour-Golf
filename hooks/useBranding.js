import { useEffect, useState } from "react";
import { FALLBACK_BRANDING } from "../lib/branding";

// Client-side hook that returns the current tenant's branding object.
//
// _document.js injects window.__TENANT_BRANDING__ server-side, so by the
// time React mounts, the branding is already present. We gate on
// typeof window to stay SSR-safe (hooks can run during server render in
// some Next.js paths).
//
// Returns the FALLBACK_BRANDING object if the global is missing, which
// should only happen on a cold error path — never in a normal request.
export function useBranding() {
  const [branding, setBranding] = useState(() => {
    if (typeof window === "undefined") return FALLBACK_BRANDING;
    return window.__TENANT_BRANDING__ || FALLBACK_BRANDING;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.__TENANT_BRANDING__) setBranding(window.__TENANT_BRANDING__);
  }, []);

  return branding;
}
