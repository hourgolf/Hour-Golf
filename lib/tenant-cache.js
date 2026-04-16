// Tenant slug → UUID cache for middleware.
//
// Runs on the Edge runtime, so it must stay free of Node-only APIs. A plain
// module-scope Map is fine: it survives across requests within a warm Edge
// function instance. Cold starts reset it, which is the correct behavior
// (any tenant change picked up on first lookup after a deploy).
//
// TTL is short (60s) so super-admin changes to the tenants table propagate
// quickly without needing an explicit invalidation signal.

const CACHE_TTL_MS = 60_000;

const cache = new Map(); // slug → { id, cachedAt }

export function getCached(slug) {
  const entry = cache.get(slug);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    cache.delete(slug);
    return null;
  }
  return entry.id;
}

export function setCached(slug, id) {
  cache.set(slug, { id, cachedAt: Date.now() });
}

// Negative cache: remember "slug does not resolve" for a shorter window so a
// stream of requests to a bad subdomain doesn't hammer Supabase.
const NEGATIVE_CACHE_TTL_MS = 10_000;
const negativeCache = new Map(); // slug → cachedAt

export function getNegativeCached(slug) {
  const cachedAt = negativeCache.get(slug);
  if (!cachedAt) return false;
  if (Date.now() - cachedAt > NEGATIVE_CACHE_TTL_MS) {
    negativeCache.delete(slug);
    return false;
  }
  return true;
}

export function setNegativeCached(slug) {
  negativeCache.set(slug, Date.now());
}
