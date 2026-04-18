# Next session handoff

*Written 2026-04-18 at end of the platform-overhaul + billing-foundation
sprint. Hand this file (and the ones it links) to the next session.*

---

## Context shift

Platform / multi-tenant work is **paused**. The platform admin console is
overhauled, self-contained, and customizable. Billing foundation is in place
but no real charging yet (intentional — the business model is still being
discussed). No urgency to build more platform features.

**New focus: Hour Golf.** Make daily operations better, streamlined, functional,
and beautiful for both admins and members. Get a real member app live.

HG is production. ~80 paying members. Every deploy touches live users.
Staged verification is mandatory.

---

## Where things stand

### Live in production
- Multi-tenant platform (HG is tenant #1, Parts Dept + Joe's Pickleball are
  zero-member test tenants).
- Per-tenant Stripe webhooks, Seam access codes, email from verified `ourlee.co`.
- Member portal with bookings, events, pro shop, loyalty, punch passes, subscriptions.
- Admin dashboard with today/calendar/usage/customers/events/shop/config/reports/settings.
- Super-admin platform at `/platform` (Supabase-style, customizable per admin).
- **Tier 2 multi-device sessions** shipped — members can hold concurrent logins.
- **264 historical payment rows** backfilled from Stripe. `payments` table matches Stripe.
- PWA manifest + icons pipeline (per-tenant).
- Test harness (`npm test` → 28 passing tests on overage / feature-guard / platform-auth).
- Apex `ourlee.co` lands on `/platform/login`.

### Observation windows (deferred cleanup)
- **Phase 7C-3** — delete `pages/api/stripe-webhook.js` shim. Pending ~24h of
  observation after the Stripe Dashboard cutover. Safe to do now if enough time
  has passed with clean green 200s on the `engaging-brilliance` webhook.
- **Tier 2 scalar columns drop** — `members.session_token` + `session_expires_at`
  can be removed after a few days of real multi-device usage. Already observed
  4+ sessions across 2 user agents so the path is live; just wants a longer soak.

### Deferred work, not blocking
- **Phase 7C-3 shim delete** (see above)
- **Tier 2 column drop** (see above)
- **#4 monthly_usage SECURITY DEFINER → INVOKER** — 2-hour task, riskier
  (handoff explicitly said "if you break this, admin dashboards show empty data").
  Worth doing in a focused session without anything else in flight.
- **Platform billing Phase 2** — wire Ourlee's own Stripe account once the
  business model is decided. All the data + UI is ready; just add the Stripe
  calls. See `docs/OURLEE_BUSINESS_OVERVIEW.md` for the pending decisions.
- **booking-webhook.js cleanup** — blocked on Skedda/Zapier sunset. The user is
  converting members to the dashboard over the coming week; after that, the
  endpoint + migration DEFAULT can come out.
- **app_settings per-user-per-tenant** is done (shipped 2026-04-17).

---

## Strategy for this new focus

### 1. Intake

Before writing any code, collect **every** tweak into one doc. Don't trust
memory — the list drives the schedule.

Suggested schema for each entry:

```
[Surface]   member | admin | shared | mobile
[Size]      trivial (<5 min) | small (~30 min) | medium (~2 hrs) | big (session+)
[Type]      bug | cosmetic | UX | feature | launch-blocker
[Priority]  P0 (broken) | P1 (noticed weekly) | P2 (nice) | P3 (when there's time)
[Note]      one-liner describing the change and who benefits
```

Tools that work well:
- A markdown file in `docs/HG_IMPROVEMENTS.md` (grepable, versionable)
- A Linear project if the list grows past ~30 items
- Start in markdown, move to Linear only if it outgrows that

### 2. Execution: one theme per session

Group the list into themes rather than working sequentially through it. A
"theme" is 5-12 tweaks that touch a related set of files / screens. Examples
you'll likely want:

- **Member booking flow polish** — the path from open portal → book a bay is
  the single most-used flow. Tiny improvements here compound.
- **Admin Today + Calendar** — the screens you live in every day as the
  operator. High leverage.
- **Email copy + design** — every transactional email is a member-brand
  touch. Batch them; they share the template layer.
- **Pro shop UX** — if HG runs more drops, this is a revenue surface.
- **Mobile-first polish** — bookings and access codes are primarily mobile.
- **PWA install UX + launch** — see §3.

For each session:
1. Open the intake list, pick a theme, pull 5-10 entries into a scratch list.
2. Order them: **bugs first, then UX, then cosmetic, then additions**.
3. For each tweak, follow the staged cadence: change → smoke test in dev →
   tight commit → next.
4. One commit per cohesive subgroup, not per file. A commit message like
   `Booking flow polish: start-time snapping, dayview spacing, price line`
   covers 3-5 related changes. Avoid `Fix typo in booking.js` as a standalone
   commit unless genuinely standalone.
5. Final pass: build + `npm test` + push.

### 3. Member app launch

HG is 85% of the way there because the PWA infra is built. Remaining work in
rough order:

**a. Tighten the install UX.** Today members add the portal to their home screen
manually. A dedicated "Install our app" surface — either a page at `/app` or a
prompt banner — that walks them through iOS + Android + desktop install makes
this usable for non-technical members. Include screenshots of the actual flow,
not generic docs.

**b. Update prompts.** When a new version deploys, PWA-installed members stay
on the stale service-worker-cached version until they close and reopen the
app. Add an "update available" banner that calls `registration.update()` and
shows "Reload to update."

**c. Member email campaign.** After the install surface exists: send every HG
member an email with the install instructions + why they'd want it (faster
bookings, one-tap access codes, no friction). ~80 recipients; can be sent via
the existing Resend integration.

**d. Push notifications (optional, nice-to-have).** Web Push works on iOS
16.4+ and all modern Androids. Use cases for HG:
- "Your access code for your 3pm booking is ready." (parallels the email)
- "Bay 2 just freed up at 5pm tonight — want it?"
- "Your monthly billing posted."

Requires: VAPID keys, a `push_subscriptions` table, a send helper, and a hook
into the access-code job + booking confirmation flows. 1-1.5 sessions of work.

**e. App Store presence (skip for now).** A Capacitor wrap for iOS / Android
app stores takes real effort (certs, reviews, release management) and isn't
necessary if the PWA does the job. Reconsider once HG has >200 members or a
specific reason to be in the store.

### 4. Commit + deploy cadence

- `main` deploys to Vercel on push. Every commit is a deploy to production.
- Prefer one smoke-tested commit over rapid-fire un-tested commits — the
  deploy cost is real (members feel it).
- After a theme session, watch Vercel logs for 15-30 min for anything
  surprising.
- Tests are now automatic (`npm test`). Failures block the push.

---

## Gotchas that carry forward

These have each bitten the codebase once already. If any of them resurface,
the fix is known:

1. **Vercel serverless freezes on response return.** `fetch().catch(…)` without
   `await` drops the network call silently. Always `await` Resend / Seam calls
   in API routes before returning.
2. **Stripe `customers.list({ email })` is case-sensitive.** Use
   `customers.search({ query: "email:'..'" })` or persist `stripe_customer_id`.
3. **Refunded-in-place rows must NOT be subtracted from paid.** The
   `overage.js` tests encode this invariant. Any future reconciliation logic
   should run against those tests.
4. **Resend sandbox + new domains.** Flipping `tenants.email_from` to an
   unverified domain silently 403s every outgoing email. The runbook documents
   this — keep it documented on any per-tenant email change.
5. **DB migrations: audit every reader/writer before tightening.** Triggers,
   views, cron, Edge middleware, edge functions, client code. Phase 2C caused
   two regressions from missed readers.
6. **Middleware uses the anon key on Edge.** Any RLS tightening on `tenants`
   or `tenant_branding` can silently break tenant resolution → HG fallback.
7. **Supabase Edge Function env vars are separate from Vercel env vars.** Keys
   like `RESEND_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` need to be updated in
   both when rotated.
8. **Platform admin and tenant admin share the `hg-auth` Supabase storage
   key.** Logging into one clobbers the other. Use incognito or separate
   browser profiles for parallel testing.

---

## Where to find things

### Operational docs
- `docs/PLATFORM_RUNBOOK.md` — super-admin operator reference. Every tenant-
  touching operation is documented (create / suspend / rotate / delete /
  diagnose). Start here if an admin action is needed.
- `docs/TENANT_ADMIN_GUIDE.md` — the doc handed to tenant admins. Nothing
  platform-level; aimed at the person running one tenant's day-to-day.
- `docs/OURLEE_BUSINESS_OVERVIEW.md` — hand-off for the business-model
  conversation. Covers current billing vs. missing billing + the open
  business questions.

### Auto-memory system
Lives at `/Users/mattlynch/.claude/projects/-Users-mattlynch-Downloads-hour-golf-live/memory/`.
Read `MEMORY.md` for the index. Especially relevant:
- `feedback_staged_verification.md` — the non-negotiable cadence
- `lessons_db_migration_audits.md` — Phase 2C audit rule
- `lessons_stripe_and_reconciliation.md` — the Stripe footguns above

### Codebase landmarks
- Member portal entry: `pages/members/*`
- Admin dashboard entry: `pages/admin/*` or shared layout components
- Platform admin: `pages/platform/*` (out of scope for this focus, but worth
  knowing it's there)
- Member API routes: `pages/api/member-*`
- Admin API routes: `pages/api/admin-*`
- Tenant config libs: `lib/branding.js`, `lib/tenant-features.js`, `lib/stripe-config.js`, `lib/seam-config.js`
- Email: `lib/email.js`
- Session auth: `lib/member-session.js`, `lib/api-helpers.js:verifyAdmin`

### Test harness
- `npm test` — runs 28 tests across `lib/overage.test.js`, `lib/feature-guard.test.js`, `lib/platform-auth.test.js`.
- `npm run test:watch` — same in watch mode while editing.
- Add `*.test.js` files next to the source file they cover. Vitest picks them up automatically.

---

## Recent commits worth knowing about (latest → older)

- `feb3dff` — Platform billing foundation + apex routing fix + business overview doc
- `a1d0d97` — Platform UI Phase B: per-admin customization (accent, density, sidebar)
- `f3a5dac` — Platform UI overhaul: Supabase-inspired identity + isolation
- `93d15fd` — Vitest harness + 28 unit tests
- `9340160` — Per-tenant PWA icons
- `b809b89` — Runbook: Resend domain verification step
- `89ba9b2` — app_settings per-tenant-per-user
- `240d5e4` — Tier 2 sessions PR2: all readers migrated
- `91c1636` — Tier 2 sessions PR1: member_sessions table + dual-write
- `68e23dd` — Phase 7C-1: per-tenant Stripe webhook routes

---

## Recommended first moves for the new session

1. Before any code: **ask the user for their list of tweaks.** Don't start
   code without the intake list — sessions burn faster when you can see all
   the related items at once.
2. Offer to **scaffold** `docs/HG_IMPROVEMENTS.md` with the schema above and
   help categorize as items come in.
3. **Pick the theme with the highest user-pain-to-effort ratio.** Usually
   that's the member booking flow — it's the most-used path.
4. Ship the first theme small + fast. Confidence in the cadence matters more
   than coverage on the first session.

---

*Ready for polish work. Hour Golf is the product; everything else is infrastructure.*
