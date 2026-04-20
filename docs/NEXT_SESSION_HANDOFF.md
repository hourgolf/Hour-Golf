# Next session handoff — security + performance audit

*Written 2026-04-19 at end of the member-polish + admin-polish sprint
(commits 4bae803 → 3d29cdd, ~25 commits over the day).*

**Next session focus: security + performance audit before broader rollout.**
This doc orients you to the platform's current state, what shipped today
(so you can verify nothing's broken), and the specific hotspots + risks
you should investigate. The working checklist lives in
[`docs/SECURITY_PERF_AUDIT.md`](SECURITY_PERF_AUDIT.md) — drive against
that one item by item.

---

## Read these first

1. **`docs/SECURITY_PERF_AUDIT.md`** — the prioritized checklist. Treat
   it as the punch list. Anything new you find, add to it.
2. **`docs/HG_IMPROVEMENTS.md`** — Shipped log + open polish items
   carrying forward.
3. **`docs/PLATFORM_RUNBOOK.md`** — operations reference. Useful when
   investigating webhook flows, tenant resolution, etc.
4. **Auto-memory `MEMORY.md`** — index of accumulated lessons,
   especially `lessons_db_migration_audits.md` (RLS / readers /
   writers checklist) and `lessons_stripe_and_reconciliation.md`.

---

## Where things stand right now

### Live in production
- ~67 paying HG members across Patron / Starter / Green Jacket / Unlimited
  tiers. ~11 Non-Members with bookings. Counts visible on Reports → Members.
- Multi-tenant scaffolding live (HG = tenant 1, Parts Dept + Joe's
  Pickleball as zero-member test tenants).
- Per-tenant Stripe webhooks, Seam access codes, Square POS sync, Shippo
  shipping, Resend email from `ourlee.co`.
- Member portal: dashboard hero with live access code + slide-to-extend,
  booking grid + sheet, events, pro shop, account, billing.
- Admin: today + week + customers + events + shop + config + reports +
  detail. Today has bulk-cancel, date nav, keyboard shortcuts, "Right
  now" + "Up next" callouts.
- Reports rebuilt to read actual cash from `payments` (Stripe + Square
  in one place) instead of estimating from member counts.
- All hours/usage/loyalty math now buckets by Pacific time (was UTC —
  caused real billing discrepancies; see "What changed today" below).
- PWA install banner + update banner + per-tenant icons.

### Test harness
- `npm test` → 28 passing tests (overage / feature-guard / platform-auth)
- Add `*.test.js` next to source files. Vitest picks them up.

### Deferred-but-unblocked cleanup (one-line commits when you have time)
- **Phase 7C-3** — delete `pages/api/stripe-webhook.js` shim. Per-tenant
  routes have been live for days now. Safe to delete after another
  observation pass.
- **Tier 2 scalar columns drop** — `members.session_token` +
  `session_expires_at`. Already replaced by `member_sessions` table.

### Known temporary state
- **Scott Casares (member #070)** was repaired manually via SQL today.
  His Stripe subscription was created via AllBooked InviteLink (not
  the HG portal), so the webhook had no member row to PATCH. The
  fix is shipped (`lib/stripe-webhook-handler.js` self-heals on
  checkout.session.completed) — but if any other migrated members
  are in the same shape, they'll need similar manual repairs. Search:

  ```sql
  -- Members who have bookings but no row in members table
  select distinct b.customer_email, b.customer_name, min(b.created_at)
  from public.bookings b
  left join public.members m on m.email = b.customer_email
  where m.id is null
  group by b.customer_email, b.customer_name;
  ```
- **Past-month overage re-attribution from the Pacific-bucketing fix**:
  the `monthly_usage` view recompute may have shifted some PT-late-night
  bookings between months. Forward-looking math is now correct; any
  charges already collected stand. Watch the admin Overview tab if
  members ask why a March overage now appears.

---

## What changed today (chronological)

| Commit | Surface | Summary |
|---|---|---|
| `e3a0672` | Member dashboard | First v1 of the redesigned hero (next-booking countdown, single progress bar, themable status colors, tappable contact, lazy QR) |
| `3532da1` | PWA + member shell | Update-available banner + qrcode.react self-host + InstallPrompt dedupe + FAB swap |
| `e37322b` | Booking flow | Inline form hidden on mobile + sticky day-bar + booking success panel + tappable sheet contact |
| `35b1ece` | Booking | DatePicker mobile overflow fix + dropped Repeat-last chip |
| `4bae803` | Email | Shared `lib/email-layout.js` + every template re-rendered through it (tenant logo, brand colors, plaintext fallback, preheader, portal CTAs, add-to-calendar links) |
| `b89b57f` | Multi-tenant | `tenant_branding.cancel_cutoff_hours / bays / bay_label_singular / facility_address / tier_colors` (migration `20260419000000`) — HG seeded with prior hardcoded values |
| `cf92f68` | Admin | TodayView/WeekView/Reports/BookingForm/Badge all read from branding; live Seam door codes on TodayView |
| `9979e39` | Member dashboard | Trim greeting + door code panel in the live hero |
| `a2a4715` | Admin Settings | Operations panel for cancel cutoff / bays / bay noun / facility address / tier colors / max daily hours (JSON editor) |
| `c0945ac` | Admin Today | "Right now" + "Up next" callouts with live remaining-time + countdown chips |
| `547a186` | Member dashboard | Slide-to-extend booking from hero (+15m); migration `20260419010000` adds `tenant_branding.max_daily_hours_per_member`; `/api/member-extend-booking` enforces conflict + tier window + daily cap; Seam access code's `ends_at` patched best-effort |
| `3f3fdac` | Admin Week | Month KPI strip + per-day density chip + per-tenant primary-color heatmap |
| `04ff4e9` | Admin | TodayView date nav + extended keyboard shortcuts (`[`/`]`/`t`/`w`) |
| `eaab39d` | Member hero | Extend ONLY visible during live session; Book another / Cancel hidden mid-session |
| `339c945` | Admin Today | Bulk-cancel multi-select with sticky bottom action bar |
| `fee9ef4` | Admin Customers | KPI strip + one-tap tier chip filter |
| `ddfe8cf` | Member dashboard + API | Hero now keeps live bookings on reload (`booking_end >= now` filter); tenant-customizable empty headline (migration `20260419020000`) |
| `6cdcae2` | Admin Settings | Bays input accepts commas (raw-text buffer pattern) |
| `cb1f81a` | Member shell | Sticky header + nav, "Book Time" → "Book", per-tab labels shortened |
| `fa161d4` | Pro Shop | Tighter sub-nav segmented pills + white top-strip card |
| `e8301c9` | Member dashboard | SlideToConfirm component (touch + mouse drag, 85% threshold, busy state); tier badge removed from header |
| `87f09cc` | **Critical billing fix** | `monthly_usage` view + `/api/member-data` + `/api/member-shop` loyalty + `/api/admin-loyalty` all switched to **Pacific-month bucketing** (was UTC, caused Matt Mahoney 3h-vs-2h discrepancy). Member loyalty now also includes Square POS spend. Migration `20260419030000`. |
| `8d94a16` | Webhook + admin | `checkout.session.completed` self-heals (creates members row when missing); new `/api/admin-update-tier` endpoint upserts via service-role + reads Stripe to link existing customer/sub by email |
| `dea2d47` | Modal | React Portal so it escapes the sticky-header stacking context |
| `15540fb` | Admin Reports | Revenue rebuilt — actual cash from `payments`, bucketed by source (Membership / Pro Shop / In-store retail / Overage / Non-member booking), net of refunds |
| `e1dc9f6` | Member account/billing | Membership + punch passes moved to `/members/account`; notifications + payment method + receipts on `/members/billing`; profile + email + password collapsed into one block; Stripe return URLs repointed |
| `3d29cdd` | Reports + Config | White card panels on every Reports sub-section; header member count fixed (counts only paying tiers); per-source bar hover tooltips; Birthday Bonus + News full-width; Members table removed from Config (redundant with Customers tab); Email Settings replaced with transactional emails catalog |

### Migrations applied today (in order)
- `20260419000000_tenant_multi_readiness.sql` — cancel_cutoff_hours, bays, bay_label_singular, facility_address, tier_colors
- `20260419010000_tenant_max_daily_hours.sql` — max_daily_hours_per_member
- `20260419020000_tenant_empty_hero_headline.sql` — dashboard_empty_headline
- `20260419030000_monthly_usage_pacific_bucket.sql` — rebuilt monthly_usage view to bucket by PT
- One-off SQL repair (no migration file): inserted Scott Casares as members #070 with Patron tier + linked Stripe customer/subscription.

---

## Architecture decisions baked in (don't break these)

1. **Pacific-time month bucketing everywhere member-facing.** `monthly_usage` view, `/api/member-data`, `/api/member-shop?action=loyalty`, `/api/admin-loyalty` all use `lib/format.pacificMonthWindow()` / `pacificMonthTag()` / `pacificMonthWindowFor(tag)`. Don't add a new aggregation that uses raw `new Date(yr, mo, 1)` — that's UTC on Vercel and will diverge.
2. **Service-role bypasses RLS for admin writes.** Admin-side mutations that the RLS policy can't accept directly (e.g. `admin-update-tier`) go through dedicated server endpoints that use `getServiceKey()`. Never let the client carry the service-role key.
3. **Branding payload is global on the client.** `window.__TENANT_BRANDING__` is injected by `_document.js`. `useBranding()` reads it. Don't re-fetch per-component.
4. **Modal goes through a React Portal.** `components/ui/Modal.js` uses `createPortal(node, document.body)` so it escapes the sticky-header stacking context. If you build a new modal-style overlay, do the same.
5. **Per-tenant Stripe routes** at `/api/stripe-webhook/[slug].js`. The legacy `/api/stripe-webhook.js` shim is still alive but slated for deletion.
6. **payments table is the single source of truth for actual cash.** Reports → Revenue reads from there, bucketed by source + description. `shop_orders` records in-app retail orders but the `payments` row (created by Stripe webhook) is what the operator's revenue numbers come from.

---

## Gotchas that carry forward

These have each bitten the codebase. If they resurface, the fix is known.

1. **Vercel serverless freezes on response return.** `fetch().catch(...)` without `await` drops the network call silently. Always `await` Resend / Seam / external calls in API routes before returning.
2. **Stripe `customers.list({ email })` is case-sensitive.** Use `customers.search({ query: "email:'..'" })` or persist `stripe_customer_id`. The new `admin-update-tier` endpoint does the right thing.
3. **Refunded-in-place rows must NOT subtract from paid.** `lib/overage.test.js` encodes this invariant.
4. **Resend sandbox + new domains.** Flipping `tenants.email_from` to an unverified domain silently 403s every outgoing email.
5. **DB migrations: audit every reader/writer before tightening.** Triggers, views, cron, Edge middleware, edge functions, client code.
6. **Middleware uses the anon key on Edge.** Any RLS tightening on `tenants` or `tenant_branding` can silently break tenant resolution → HG fallback.
7. **Supabase Edge Function env vars are separate from Vercel env vars.** Keys like `RESEND_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` need to be updated in both when rotated.
8. **Platform admin and tenant admin share the `hg-auth` Supabase storage key.** Logging into one clobbers the other. Use incognito for parallel testing.
9. **Sticky stacking contexts beat z-index.** A child with `z-index: 9999` inside a `z-index: 1` parent loses to a sibling at `z-index: 100`. Use a portal.
10. **Pacific time isn't fixed-offset.** PDT (UTC-7) in summer, PST (UTC-8) in winter. `lib/format.pacificMonthWindow()` round-trips through `Intl` to handle DST correctly.

---

## Recommended first moves for next session

1. **Open `docs/SECURITY_PERF_AUDIT.md`.** It's the punch list for the
   security + performance pass. Walk it top-to-bottom — items are sorted
   roughly by impact × ease.
2. **Spot-verify today's billing fix in production.** Check Reports →
   Revenue (should show ~$22k all-time, ~$1.5k April). Check Matt
   Mahoney's monthly_usage row (should be 2.0h April). Check Scott
   Casares (should now show as Patron).
3. **Don't ship perf or security changes without smoke-testing.** Same
   staged cadence — change → smoke → tight commit → next.
4. **HG is live production.** Same rule as before: every push hits ~67
   paying members. Don't push directly to main if the change is
   non-trivial — branch + Vercel preview + verify.

---

*Ready for the security + performance pass. Hour Golf is the product;
the platform is increasingly multi-tenant capable underneath; everything
else is plumbing.*
