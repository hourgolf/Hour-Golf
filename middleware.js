// Next.js Edge middleware — runs on every request, resolves the tenant from
// the Host header, and attaches x-tenant-id to the request so downstream API
// routes and pages can use it.
//
// Behavior today (single-tenant, default Vercel URL):
//   - Host does not match `.platform.com` → skip Supabase lookup entirely
//     and set x-tenant-id to the Hour Golf UUID via the fallback path.
//   - No added latency for Hour Golf requests.
//
// Behavior once we add subdomains (hourgolf.platform.com, testvenue.platform.com):
//   - Parse slug from subdomain, look up in tenants table (cached 60s).
//   - Found → set x-tenant-id to that tenant's UUID.
//   - Not found + MULTI_TENANT_STRICT=false (default) → fall back to Hour Golf.
//   - Not found + MULTI_TENANT_STRICT=true → return 404.
//
// Safety: this middleware only ADDS a header. No API route reads x-tenant-id
// yet (that's Phase 2B). So shipping this changes zero runtime behavior.

import { NextResponse } from 'next/server';
import { getCached, setCached, getNegativeCached, setNegativeCached } from './lib/tenant-cache';

const HOURGOLF_TENANT_ID = '11111111-1111-4111-8111-111111111111';
const PLATFORM_DOMAIN_SUFFIX = '.ourlee.co';
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://uxpkqbioxoezjmcoylkw.supabase.co';

// Return the tenant slug if the host is a platform subdomain, else null.
// Examples:
//   hourgolf.ourlee.co          → "hourgolf"
//   testvenue.ourlee.co:3000    → "testvenue"
//   ourlee.co                   → null  (apex, falls back)
//   hour-golf-live.vercel.app   → null  (falls back)
//   localhost:3000              → null  (falls back)
function parseSlugFromHost(host) {
  if (!host) return null;
  const hostname = host.split(':')[0].toLowerCase();
  if (!hostname.endsWith(PLATFORM_DOMAIN_SUFFIX)) return null;
  const slug = hostname.slice(0, -PLATFORM_DOMAIN_SUFFIX.length);
  // Reject empty or multi-part slugs (defense against unexpected hosts)
  if (!slug || slug.includes('.')) return null;
  return slug;
}

async function resolveTenantBySlug(slug) {
  const cached = getCached(slug);
  if (cached) return cached;

  if (getNegativeCached(slug)) return null;

  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anon || !SUPABASE_URL) return null;

  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/tenants?slug=eq.${encodeURIComponent(slug)}&status=eq.active&select=id`,
      {
        headers: { apikey: anon, Authorization: `Bearer ${anon}` },
        // Edge fetch respects AbortSignal; cap at 2s so a stalled Supabase
        // doesn't block every request indefinitely.
        signal: AbortSignal.timeout(2000),
      }
    );
    if (!resp.ok) {
      setNegativeCached(slug);
      return null;
    }
    const rows = await resp.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      setNegativeCached(slug);
      return null;
    }
    const id = rows[0].id;
    setCached(slug, id);
    return id;
  } catch {
    // Network error, timeout, etc. Don't cache negative on transient errors;
    // next request retries. Returning null falls through to strict/fallback logic.
    return null;
  }
}

export async function middleware(request) {
  const strict = process.env.MULTI_TENANT_STRICT === 'true';
  const host = request.headers.get('host') || '';
  const slug = parseSlugFromHost(host);
  const pathname = request.nextUrl.pathname;

  let tenantId = HOURGOLF_TENANT_ID;
  let source = 'fallback';

  if (slug) {
    const resolved = await resolveTenantBySlug(slug);
    if (resolved) {
      tenantId = resolved;
      source = 'subdomain';
    } else if (strict) {
      return new NextResponse('Tenant not found', { status: 404 });
    }
    // Non-strict + unresolved: keep Hour Golf fallback, source stays 'fallback'.
  }

  const headers = new Headers(request.headers);
  headers.set('x-tenant-id', tenantId);
  headers.set('x-tenant-source', source);

  // /manifest.json -> /api/manifest rewrite. Lives here (not in
  // next.config.js `rewrites()`) because any rewrites entry in next.config.js
  // makes Vercel attach `x-vercel-enable-rewrite-caching: 1` to every
  // response, which Edge-caches HTML for minutes and ignores
  // Cache-Control: no-store. Middleware-level rewrites don't trigger that.
  let response;
  if (pathname === '/manifest.json') {
    const url = request.nextUrl.clone();
    url.pathname = '/api/manifest';
    response = NextResponse.rewrite(url, { request: { headers } });
  } else {
    response = NextResponse.next({ request: { headers } });
  }

  return response;
}

// Note: Vercel's Edge CDN cache bypass is done via getServerSideProps on
// every tenant-branded page (see lib/no-cache-ssr.js). Cache-Control and
// Vercel-CDN-Cache-Control headers set here from middleware did not
// influence the Edge cache decision in testing.

// Match all paths except Next.js internals and static assets. Middleware must
// run on both pages AND API routes so getTenantId(req) works everywhere.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|fonts/|.*\\.(?:png|jpg|jpeg|gif|svg|ico|woff2|woff|ttf|webp|avif)).*)',
  ],
};
