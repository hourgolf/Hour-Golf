// Security helpers for API routes. Keep the surface tiny so every caller
// uses the same rules.

// --- CSRF protection via Origin/Referer check ------------------------------
//
// The member portal authenticates with a `hg-member-token` cookie (HttpOnly,
// SameSite=Lax, Secure in prod). SameSite=Lax already blocks classic form-
// submission CSRF, but a subtle gap remains: a foreign origin can open our
// site in a popup/iframe and trigger a same-site POST via fetch() with
// credentials:'include'. Verifying that the Origin (or Referer) header
// matches the Host we're serving closes that gap.
//
// Every modern browser sends Origin on every POST/PATCH/DELETE. We only fall
// back to Referer when Origin is missing (some Safari + privacy-extension
// edge cases).
//
// Usage:
//
//   if (!requireSameOrigin(req, res)) return;
//
// Returns true on success. On failure, writes 403 and returns false.
export function requireSameOrigin(req, res) {
  const host = String(
    req.headers["x-forwarded-host"] || req.headers.host || ""
  ).toLowerCase();
  if (!host) {
    res.status(400).json({ error: "missing host" });
    return false;
  }

  const origin = String(req.headers.origin || "");
  const referer = String(req.headers.referer || "");

  const hostMatch = (url) => {
    if (!url) return false;
    try {
      return new URL(url).host.toLowerCase() === host;
    } catch {
      return false;
    }
  };

  if (origin) {
    if (!hostMatch(origin)) {
      res.status(403).json({ error: "origin mismatch" });
      return false;
    }
    return true;
  }

  // No Origin header → accept only if Referer is same-origin. Some clients
  // (mobile webviews, RSS readers) omit both; reject those too to keep the
  // rule simple. The only legitimate no-Origin caller is a curl-like tool,
  // which isn't a real user flow.
  if (!hostMatch(referer)) {
    res.status(403).json({ error: "origin missing" });
    return false;
  }
  return true;
}

// --- In-process rate limiter -----------------------------------------------
//
// On Vercel serverless the Map lives for the life of a warm instance, so
// a single client hitting one region is rate-limited in practice even
// though cross-instance sharing is not guaranteed. For tenant-scale
// credential-stuffing attacks this is sufficient; for platform-scale
// guarantees swap in Upstash Redis or Vercel KV (drop-in replacement:
// same {allowed, remaining, resetIn} interface).

const buckets = new Map();
const MAX_ENTRIES = 50_000;

function prune(now) {
  if (buckets.size < MAX_ENTRIES) return;
  for (const [k, v] of buckets) {
    if (v.reset <= now) buckets.delete(k);
    if (buckets.size < MAX_ENTRIES * 0.9) break;
  }
}

export function rateLimit({ key, limit, windowMs }) {
  const now = Date.now();
  prune(now);
  const b = buckets.get(key);
  if (!b || b.reset <= now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetIn: windowMs };
  }
  if (b.count >= limit) {
    return { allowed: false, remaining: 0, resetIn: b.reset - now };
  }
  b.count++;
  return { allowed: true, remaining: limit - b.count, resetIn: b.reset - now };
}

// Extract a best-effort client IP. Vercel always sets x-forwarded-for; the
// socket fallback is for local dev only.
export function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0].trim();
  }
  const xr = req.headers["x-real-ip"];
  if (typeof xr === "string" && xr.length > 0) return xr;
  return req.socket?.remoteAddress || "unknown";
}

// Convenience wrapper — writes a 429 on violation, returns true on success.
export function enforceRateLimit(req, res, { bucket, limit, windowMs }) {
  const ip = getClientIp(req);
  const key = `${bucket}:${ip}`;
  const result = rateLimit({ key, limit, windowMs });
  if (!result.allowed) {
    res.setHeader("Retry-After", Math.ceil(result.resetIn / 1000));
    res.status(429).json({ error: "Too many requests. Please try again later." });
    return false;
  }
  return true;
}
