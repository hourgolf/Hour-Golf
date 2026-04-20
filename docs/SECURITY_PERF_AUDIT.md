# Security + performance audit — pre-rollout punch list

*Working checklist for the next session. Drive top-to-bottom. Items are
ordered roughly by impact × ease. Mark `[x]` when shipped or
deliberately deferred (with a reason). Add new findings inline.*

---

## How to work this list

- One area per branch / commit. Don't bundle perf + security changes
  into the same diff — they need different review lenses.
- Where a fix needs a DB migration, dry-run via `mcp__supabase__execute_sql`
  with `EXPLAIN` first.
- Smoke-test on Vercel preview before push to main. HG members feel
  every deploy.
- Anything you can't fix in-session, log it here as `[deferred] —
  reason` so the next pass picks it up cold.

---

## Section 1 — Security audit

### 1.1 Tenant isolation
- [ ] **Confirm `x-tenant-id` cannot be spoofed by client.** `middleware.js`
  resolves tenant from Host → sets `x-tenant-id`. Verify Next strips any
  client-provided `x-tenant-id` header before middleware runs (or that
  `req.headers["x-tenant-id"]` always reflects middleware's value, never
  the client's). If a client could set this header, every API route
  would scope to whatever tenant they claim.
- [ ] **`getTenantId(req)` fallback is HG.** Audit every API route — is
  HG-fallback the right default for that route, or should an unknown
  tenant 404? Today it's permissive everywhere.
- [ ] **RLS policies on every public.* table.** Walk through pg_policies
  and confirm:
    - `tenant_isolation` is present + matches `app.tenant_id` setting
    - `admin_all` policy joins admins.tenant_id = members.tenant_id
      (don't accept admin from another tenant just because they're
      authenticated)
    - INSERT policies require tenant_id be present in the payload
    - No policies left as PERMISSIVE for `public` role with a
      `qual: true` (= unrestricted)
  Bug we already hit: members INSERT denied admin auth (Scott Casares
  case). Fixed with service-role endpoint. Audit similar gaps.
- [ ] **`x-tenant-id` set by middleware vs `app.tenant_id` set by RLS.**
  Two different mechanisms. Confirm both are populated on every request
  path that touches RLS-gated tables.

### 1.2 Auth + sessions
- [ ] **Member session cookie attributes.** `pages/api/member-signup.js`
  sets `hg-member-token` with `HttpOnly; SameSite=Lax; Secure` (in prod).
  Audit: is `Secure` actually applied in all envs? Is `SameSite=Lax`
  the right pick for the cross-subdomain flows once tenants get
  subdomains? `SameSite=Strict` blocks Stripe checkout returns.
- [ ] **Session token entropy + rotation.** 32-byte random hex via
  `crypto.randomBytes(32)`. Good. Rotate on password change?
- [ ] **Admin JWT scope.** `verifyAdmin()` in `lib/api-helpers` reads
  the bearer token and checks against `admins` table. Confirm:
    - Token can't be reused across tenants (admins.tenant_id check)
    - Token expiry / refresh path
    - Where the JWT is stored client-side (localStorage? cookie?)
- [ ] **Service-role key never in client bundle.** Verify
  `SUPABASE_SERVICE_ROLE_KEY` is only `process.env.*` in `lib/` and
  `pages/api/`, never imported into anything that bundles for the
  browser. Quick check: `grep -r SERVICE_ROLE components/ hooks/`.
- [ ] **Anon key exposure.** Anon key IS shipped to client (used by
  middleware + branding load). Confirm RLS makes that safe — anon
  cannot read sensitive tables (members, payments, admins).

### 1.3 Webhook signature verification
- [ ] **Stripe webhook signature.** Per-tenant route at
  `/api/stripe-webhook/[slug].js` should verify the Stripe-Signature
  header against the per-tenant webhook secret. Confirm.
- [ ] **Square webhook signature.** `lib/square-webhook.js` — verify
  HMAC signature against the per-tenant Square signing key.
- [ ] **Shippo webhook auth.** Uses URL-token (Shippo doesn't sign).
  Confirm token storage + rotation path.
- [ ] **Resend webhook (if any).** N/A unless we add bounce / complaint
  handling.

### 1.4 CSRF
- [ ] **Session-cookie POST endpoints need CSRF protection.** Routes
  that authenticate via `hg-member-token` cookie:
    - `/api/member-cancel`
    - `/api/member-extend-booking`
    - `/api/member-shop` (POST/PATCH)
    - `/api/member-preferences`
    - `/api/member-change-email`
    - `/api/member-change-password`
    - `/api/member-subscription` (POST/PATCH/DELETE)
    - `/api/punch-pass-purchase`
    - `/api/member-setup-payment`
    - `/api/member-shop-requests`
  Same-origin policy + `SameSite=Lax` provides partial protection,
  but NOT for POST from a malicious site that opens a window to ours.
  Recommend: add a `X-Requested-With` header check OR a CSRF token
  pattern.
- [ ] **Admin endpoints.** Use bearer JWT (not cookie) → not vulnerable
  to classic CSRF. Confirm admin routes don't ALSO honor cookie auth.

### 1.5 Rate limiting + abuse
- [ ] **`/api/member-signup`** — no current rate limit. Email-bombing
  vector. Add per-IP throttle (e.g. 5/hour) or CAPTCHA on the signup
  form.
- [ ] **`/api/member-forgot-password`** — same. Could spam reset emails
  to any address.
- [ ] **`/api/customer-availability`** — currently unauthenticated
  (used by the booking flow before login). Allows date probing of
  specific tenants. Acceptable but rate-limit by IP + tenant.
- [ ] **Login (`/api/member-login`)** — needs throttling against
  credential stuffing. Lockout after N failed attempts? Audit.

### 1.6 Public surfaces
- [ ] **`/api/public-shop`** — what does it expose? Confirm it doesn't
  leak member-specific pricing or stock that internal-only.
- [ ] **`/verify?token=...`** — the QR-code landing page. Token is
  `members.verify_token` (text). Confirm it's not guessable + that
  it only reveals the member's name + tier (not contact info, payment).

### 1.7 Email + content injection
- [ ] **Audit `lib/email.js` for unescaped user input.** Every
  template should pass member-supplied values (`customer_name`,
  `description`, `notes`, etc.) through `escapeHtml` before
  interpolating. Search for `${.*}` inside template strings to find
  any that bypass escaping.
- [ ] **`lib/email-layout.js`** — confirm `bodyHtml` is trusted (built
  by us, not user input). The escape happens at the level above.

### 1.8 File uploads
- [ ] **Logo / icon / shop image uploads** — `pages/api/upload-logo.js`,
  `upload-font.js`, `upload-shop-image.js`, `platform-upload.js`.
  Verify:
    - Content-Type validation (don't accept arbitrary binary as
      "image")
    - File-size limits (currently mentioned in branding settings, but
      enforced server-side?)
    - Random filename / path-traversal protection
    - Stored in a public bucket (acceptable) but mime-sniffed
- [ ] **PWA manifest icon (`/api/manifest.js`)** — generates per-tenant
  manifest. Confirm it can't be poisoned by malicious tenant data.

### 1.9 Database
- [ ] **Indexes audit.** See perf section 2.4 — indexes also matter for
  RLS evaluation perf (slow RLS check = slow query = DOS surface).
- [ ] **Service-role usage in client?** `grep` confirms not, but
  re-verify after any new lib/ files this session.
- [ ] **`pg_policies` permissions per role.** Document which tables
  allow which roles to do what. The `members` table policy denied
  admin INSERT today — find similar gaps before they bite.

---

## Section 2 — Performance audit

### 2.1 Initial page load
- [ ] **Bundle size by route.** Run `npx next build` and read the
  per-route JS sizes. Member dashboard + admin index will be
  heaviest. Compare to baseline.
- [ ] **Code-split admin views.** `ConfigView.js` (1100+ lines),
  `ReportsView.js` (~900 lines), `DetailView.js` (~400 lines) all
  load on every admin page hit. Lazy-load via `next/dynamic` so
  only the active view's JS ships.
- [ ] **Member-portal vs admin-portal split.** Confirm admin code
  isn't bundled into the member portal route and vice versa.
- [ ] **Inline styles.** Many components use sprawling `style={{ ... }}`
  blocks. Consider moving repeated patterns to CSS classes — smaller
  bundles + better gzip ratios.
- [ ] **Background image (`/blobs/azalea_bg.png`)** — what's the
  file size? Painted-canvas backgrounds tend to be huge JPGs/PNGs.
  Convert to AVIF or WebP, lazy-load, add `loading="lazy"`.

### 2.2 Hot-path API routes
- [ ] **`/api/member-data`** — called on every dashboard load + auto-
  refresh (60s on admin). Currently does:
  - 1 session lookup
  - 1 tier_config fetch
  - 1 upcoming bookings fetch
  - 1 month bookings fetch
  - Bonus reconciliation walk (N fetches per unreconciled month)
  - Access codes attach (1 fetch)
  - Loyalty fetch (1 fetch)
  - News fetch (1 fetch)
  - Purchases fetch (1 fetch)
  - Events fetch (1 fetch)
  All sequential or partial parallel. Audit + parallelize where safe.
- [ ] **`hooks/useData.js`** — admin's data hook auto-refreshes every
  60s, fetching 6 tables in parallel. With 5000-row booking limits +
  monthly_usage view (which can be expensive), this is potentially
  heavy. Add an in-memory cache layer with stale-while-revalidate?
- [ ] **monthly_usage view performance.** It's a multi-LEFT-JOIN +
  GROUP BY across members × tier_config × bookings. EXPLAIN ANALYZE
  it on production-size data. Materialize if slow.
- [ ] **`/api/admin-loyalty` POST** (end-of-month processor) walks
  every member × every rule with one POST per (member, rule). Could
  batch.

### 2.3 React render hotspots
- [ ] **MemberDashboard hero `now` state ticks every minute** →
  re-renders entire hero. Confirm child components are memoized
  enough that the only thing actually recomputing is the countdown
  text.
- [ ] **TodayView callouts** — same once-per-minute tick for live
  bookings + countdowns. Audit re-render scope.
- [ ] **Admin index `useData` 60s interval** — interrupts whatever
  the operator is editing. If they're typing in a form, every
  refresh re-runs the full data merge. Consider pause-on-focus or
  longer interval when active forms are open.

### 2.4 Database
- [ ] **Indexes** — at minimum:
  ```sql
  -- bookings hot paths
  create index if not exists idx_bookings_email_tenant_status_start
    on public.bookings (customer_email, tenant_id, booking_status, booking_start);
  create index if not exists idx_bookings_tenant_start
    on public.bookings (tenant_id, booking_start);
  create index if not exists idx_bookings_tenant_bay_status_start
    on public.bookings (tenant_id, bay, booking_status, booking_start);

  -- payments hot paths
  create index if not exists idx_payments_tenant_status_billing
    on public.payments (tenant_id, status, billing_month);
  create index if not exists idx_payments_member_tenant_status
    on public.payments (member_email, tenant_id, status);
  create index if not exists idx_payments_charged_booking
    on public.payments (charged_booking_id) where charged_booking_id is not null;

  -- access_code_jobs (TodayView lookup + extension flow)
  create index if not exists idx_access_codes_tenant_status_booking
    on public.access_code_jobs (tenant_id, status, booking_id);

  -- shop_orders + shop_items
  create index if not exists idx_shop_orders_tenant_member_status_created
    on public.shop_orders (tenant_id, member_email, status, created_at);
  ```
  Run EXPLAIN ANALYZE before + after on the worst queries.
- [ ] **monthly_usage view → materialized?** If EXPLAIN says it scans
  big chunks, materialize and refresh on bookings INSERT/UPDATE via
  trigger.
- [ ] **`payments.billing_month` is timestamptz** but used as a
  month bucket. Could be `date` or `text "YYYY-MM"` for cleaner
  indexing. Audit.

### 2.5 Caching
- [ ] **Branding cache** — `lib/branding.js` already has 60s in-memory
  cache. Cold serverless instances re-fetch. For HG (constant hot
  traffic) the warm instance hits cache 99% of the time. For new
  tenants with bursty traffic, consider Vercel KV.
- [ ] **Tenant features cache** — `lib/tenant-features.js`. Same
  pattern.
- [ ] **HTTP cache headers** — most API routes don't set Cache-Control.
  Routes that return tenant-public data (`/api/customer-availability`,
  `/api/public-shop`, `/api/manifest`) could send short-TTL
  `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`
  to reduce cold-start hits.

### 2.6 Member dashboard
- [ ] **`/api/member-data` waterfall** (see 2.2). Member dashboard
  is the most-loaded surface; reducing this round-trip bundle is
  the single biggest member-facing perf win.
- [ ] **PWA service worker** — currently minimal (no precache, no
  fetch handler). Adding precache for the static shell + member-data
  swr would speed up cold opens significantly. Already have the
  update-detection pipeline so a new SW shipping is safe.

### 2.7 Logging + observability
- [ ] **`console.log` / `console.error` in API routes** — fine for
  Vercel logs, but consider what you DON'T want in logs (Stripe
  customer ids, member emails). Audit for PII leakage.
- [ ] **Add a /api/health endpoint** — current way to check DB +
  Stripe + Resend availability is to load the dashboard. Pingable
  health endpoint helps uptime monitoring.

---

## Section 3 — Quick wins (do these first if time-constrained)

These are the highest impact + lowest effort items. Pull from the
sections above when you start the session.

1. **Add the indexes from 2.4.** Pure perf win, zero downstream
   risk. Probably 5 minutes of EXPLAIN ANALYZE + apply.
2. **Code-split ConfigView + ReportsView via `next/dynamic`.** Drops
   admin index bundle by hundreds of KB.
3. **Audit `members`, `payments`, `bookings`, `tenant_branding` RLS
   policies.** Make sure the patterns we know are sound (Scott case)
   are enforced everywhere.
4. **Add CSRF protection to member POST endpoints.** Quick header-check
   pattern + matching client send.
5. **Rate-limit `/api/member-signup` + `/api/member-forgot-password`.**

---

## Notes / findings

*Add things as you find them. Reference commit SHAs.*

- (none yet — fill in during session)
