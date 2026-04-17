// Server-side feature flag guard for API routes.
//
// Usage inside an API handler:
//
//   import { assertFeature } from "../../lib/feature-guard";
//   import { getTenantId } from "../../lib/api-helpers";
//
//   export default async function handler(req, res) {
//     const tenantId = getTenantId(req);
//     if (!(await assertFeature(res, tenantId, "pro_shop"))) return;
//     // ...normal route logic...
//   }
//
// The handler contract: assertFeature returns `true` when the feature
// is enabled for the tenant, or sends a 404 response and returns
// `false` (so the caller can early-return). 404 (not 403) is
// intentional — a disabled feature should look like it doesn't exist,
// not like an auth problem.
//
// Fail-open: if the feature flag lookup throws or can't resolve, the
// request continues as if enabled. Hour Golf + production availability
// trump strict flag semantics. See lib/tenant-features.js for the same
// policy on the SSR side.

import { loadFeatures, isFeatureEnabled } from "./tenant-features";

export async function assertFeature(res, tenantId, featureKey) {
  try {
    const features = await loadFeatures(tenantId);
    if (isFeatureEnabled(features, featureKey)) return true;
    if (res && typeof res.status === "function") {
      res.status(404).json({
        error: "feature_disabled",
        detail: `Feature \`${featureKey}\` is not enabled for this tenant.`,
      });
    }
    return false;
  } catch (err) {
    // Fail-open: if the lookup itself blew up, don't block the route.
    // Log loudly so ops can see flag-system outages.
    console.error("assertFeature lookup failed (failing open):", featureKey, err?.message || err);
    return true;
  }
}
