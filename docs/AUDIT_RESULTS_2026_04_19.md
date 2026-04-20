# Security + performance audit — 2026-04-19 results

Written at the end of the `security-perf-audit-2026-04-19` branch. Three
commits land this pass. Summary is in plain English — skip to "Service
upgrades" if you just want the forward-looking list.

---

## What shipped (three commits)

### 1. Database hardening (`14ec93d`)

**The most important fix of the session.** The `monthly_usage` view — the
one that shows every member's hours, overage, and billing by month —
was leaking across tenants. It ran as the postgres superuser inside
Supabase (a "security definer" view), and the public anon key had read
access on it. In plain terms: anyone who knew the anon key (which is
public by design — it ships in every browser) could hit
`/rest/v1/monthly_usage` and receive a dump of every member's name,
email, tier, hours, and overage charges across every tenant on the
platform.

Now the view runs as the caller, anon has zero permissions on it, and
the admin dashboard continues to work because admins pass the same
tenant-scoped RLS policy that was already in place on members, bookings,
and tier_config.

Also pinned the `search_path` on twelve SQL functions (prevents a
category of SQL-side hijacking), and added four composite indexes that
anticipate the load as HG grows past the current ~874 bookings and ~296
payments rows.

### 2. Bundle + request speed + CSRF + rate limiting (`6e0de01`)

**Bundle.** The admin dashboard was shipping all nine views to every
admin on first page load. TodayView is the only thing anyone sees
immediately — the other eight load when you click the tab. Those eight
now ship as separate JavaScript chunks and are fetched on first click.
ConfigView alone was 1,128 lines that shipped on every admin page hit.

**Request speed.** `/api/member-data` is the endpoint the member app
calls every time a member opens their dashboard. It was doing three
database queries in sequence (tier → bookings → month-bookings) that
didn't depend on each other. Now they run in parallel. Should save
~300–800ms on every dashboard load.

**CSRF.** Every cookie-authed mutating endpoint (cancel, extend, change
email, change password, shop checkout, punch pass purchase, event
register, etc. — 16 endpoints total) now verifies that the request
Origin matches the site's host. `SameSite=Lax` cookies already block
the classic form-submission attack; this closes the fetch-with-credentials
gap for extra safety.

**Rate limits.** Three high-risk endpoints got IP-based throttling:
- Signup: 5 per hour per IP
- Password reset: 3 per hour per IP
- Login: 10 per 10 minutes per IP

This is in-process memory — good enough to throttle a single bot but
not perfect across Vercel's scaled instances. See "Service upgrades"
below for the proper upgrade path.

**Housekeeping.** Added a `.gitignore`. The repo didn't have one, which
is why `git status` always listed `.next/` and `node_modules/`.

### 3. Upload hardening + email injection fix (`1e4d8c1`)

**Uploads.** The four image upload endpoints (logo, event image, shop
image, platform upload) previously trusted whatever Content-Type the
browser sent. An admin could upload an HTML file labeled as an image,
and the Supabase Storage URL would serve it as HTML — a stored-XSS
path if a compromised admin account ever occurred. Now every image
upload sniffs the first few bytes of the file, matches them against a
whitelist (PNG, JPEG, GIF, WebP, AVIF), and rejects anything else. The
MIME sent to storage is derived from the actual file bytes, not the
browser header. SVG is excluded intentionally — it permits embedded
scripts.

**Email injection.** Found one real injection in
`member-event-comments.js`: a member's name and comment body were
interpolated raw into an admin notification email. A member with
`<img src=x onerror=...>` in their name would have it render in the
admin's inbox. Admin is the target so impact was low, but it's now
escaped properly.

---

## What's still open from the audit checklist

Not ignored — deliberately scoped out because each is either (a) already
verified safe or (b) risky to touch without a dedicated test pass.

| Item | Why deferred |
|---|---|
| Tighten public storage bucket listing (`fonts`, `logos`) | WARN, not ERROR. Removing the broad SELECT could break production image loads on a corner case; needs preview-branch testing. |
| Enable Supabase Auth leaked-password protection | One-click toggle in the Supabase dashboard. Flip it in Auth → Password Security. No code change needed. |
| Consolidate `multiple_permissive_policies` advisor warnings | Pure CPU/query-planner cost on tables where the redundant `tenant_isolation` policy is effectively a no-op. Correct to simplify eventually; no functional impact today. |
| `monthly_usage` materialized view | Current EXPLAIN: 3.77ms against 874 bookings. Not a bottleneck yet. Revisit at ~10k bookings. |
| Shippo webhook PII log | `console.error` includes a `member_email`. Useful for debugging shipping email failures. Either switch to structured logging with PII scrub (Sentry) or redact inline — recommended to do at the Sentry step. |
| `1-min now tick` render optimization | Under 60s intervals with only ~10 booking rows in view, a full re-render is under 5ms. Not a real bottleneck. |
| `send-email.js` `buildFallbackHtml` escaping | The `variables` object is interpolated raw into HTML. Only reachable when `email_config.resend_template_id` is null (which isn't the current prod config). Flag for a follow-up that either deprecates the fallback or runs it through `escapeHtml`. |
| CSRF on admin endpoints | Admin endpoints use a bearer JWT (not a cookie) — classic CSRF doesn't apply. Audited to confirm no admin route also accepts cookie auth. |

---

## Service upgrades worth considering

Ranked by impact-per-dollar. Each one is an opinionated "here's what I'd
spin up next" rather than a must-do.

### Tier 1 — small paid upgrades with outsized safety/perf wins

1. **Vercel KV or Upstash Redis** (~$10/mo or free tier)
   Replaces the in-process rate limiter shipped this session with one
   that works correctly across Vercel's scaled serverless instances.
   Without this, the 5-per-hour signup limit only applies within a
   single warm Node instance; a determined attacker could burn through
   multiple instances to amplify. With KV, limits are globally
   enforced. The `lib/security.js` helper is already shaped for
   a drop-in swap.

2. **Sentry** (free dev tier, ~$26/mo starter)
   Replaces the `console.error(...)` scatter with structured error
   capture. Automatic PII scrubbing, stack traces with source maps,
   alerting on error rate spikes, and a single place to see "which
   endpoint is failing for which tenant". Particularly valuable now
   that the platform is multi-tenant — lets you group issues by tenant.
   Also makes the PII-in-logs concern mostly moot.

3. **Turnstile or hCaptcha on signup + login** (free)
   Defense-in-depth on top of the rate limits. Cloudflare Turnstile
   is invisible for most users, pops a challenge for suspicious
   traffic. Pairs naturally with the new `requireSameOrigin` /
   `enforceRateLimit` helpers — two more lines in the same block.

4. **Supabase Pro** (already on it, but verify features enabled)
   - Turn on "Leaked password protection" (Auth → Password Security).
     Free check against the Have-I-Been-Pwned database.
   - Turn on MFA for platform admins specifically.
   - Verify daily backup retention is at least 7 days.

### Tier 2 — platform maturity steps

5. **Upstash QStash or Vercel Cron + queue**
   `/api/admin-loyalty` walks every member × every rule at month-end,
   one POST per combination. As HG grows, this will time out the
   Vercel function or hit rate limits. A queue decouples the work from
   the invocation. Same pattern for the birthday bonus cron.

6. **Image CDN (Cloudflare Images, Cloudinary, or imgproxy)** (~$5–20/mo)
   Right now `public/blobs/azalea_bg.png` and every shop image ship
   as-is to every member's phone. An image CDN auto-serves WebP/AVIF,
   resizes on the fly, and caches globally. The member dashboard's
   background alone is likely the single biggest payload on the page.

7. **Vercel Analytics + Web Vitals** (built-in, free up to a limit)
   Gives you real-user metrics (not just synthetic benchmarks) per
   route. Shows whether the code-split landed correctly for actual
   members and whether any page regresses.

8. **CSP (Content Security Policy) header** (one-config change in
   `next.config.js`) — defense in depth against future XSS. Constrains
   what origins can load scripts, fonts, images, etc. Start in
   report-only mode to see what breaks before enforcing.

### Tier 3 — bigger infra changes (revisit later)

9. **Supabase Edge Functions for tenant-routed webhooks** — move
   Stripe/Square webhook handling off Vercel to keep the serverless
   cold-start budget for user-facing traffic. Not needed until Vercel
   function duration or cost becomes a concern.

10. **Separate database read replicas** for reporting queries (admin
    Reports tab specifically). Would shield the live member-facing
    paths from a slow report. Only matters once Reports queries get
    heavy — still lightweight at current scale.

11. **Row-level encryption for sensitive PII** (birthday, phone) —
    Supabase Vault / pgsodium pattern. Not a current gap (Supabase's
    encryption at rest covers the threat model today) but worth
    documenting as a future hardening step if compliance becomes a
    requirement.

---

## Suggested next moves

In order, if you pull the next thread:

1. **Verify the admin dashboard still loads.** The `monthly_usage`
   switch to `security_invoker` changed the permissions path. It
   should work — admins pass the pre-existing `admin_all` RLS policy
   on the three underlying tables — but this is the single riskiest
   change in the branch and deserves a real eyes-on smoke test before
   merging to `main`.
2. **Flip the Supabase Auth leaked-password toggle.** 30 seconds in
   the dashboard. Free. No code.
3. **Spin up Sentry.** Five minutes to set up, replaces the handful of
   PII log lines and gives you a baseline for everything else.
4. **Pick one of Tier 1 #1 (KV rate limits) or Tier 2 #6 (image CDN)
   depending on whether you're prioritizing security or member
   experience next.**

---

*Branch: `security-perf-audit-2026-04-19`. Three commits ahead of main.
All 28 existing unit tests pass. Production build compiles; the
page-data collection step fails locally on missing env vars (same on
`main`), so it still needs Vercel preview verification before merge.*
