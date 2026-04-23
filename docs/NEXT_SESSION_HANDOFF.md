# Next session handoff — admin dashboard workflow polish

*Written 2026-04-23 at the end of the launch-week sprint
(commits ~15540fb → 72c299d, roughly 70 commits over 5 days).*

**Next session focus: improve the admin dashboard workflow without
touching anything a member might see or need to reload for.** The
member app is live with ~72 paying members; we just ran the launch
broadcast successfully (47/72 initial, 25 retried clean after a
Resend rate-limit fix). Every member-facing change from here forward
needs caution; the admin side is free to iterate hard.

---

## Read these first (in order)

1. **This file** — orientation + scope guardrails.
2. **Auto-memory `MEMORY.md`** — accumulated lessons from prior
   sessions, especially `lessons_db_migration_audits.md` (audit all
   readers/writers before tightening anything on shared tables).
3. **`docs/HG_IMPROVEMENTS.md`** — shipped log + open polish items
   that might still apply to admin workflow.
4. **`docs/SKEDDA_CUTOVER_PLAN.md`** — cutover is scheduled but not
   yet executed. The three cutover emails are staged in
   `/lib/email.js` (`sendCutoverAnnouncement`, `sendCutoverReminder`,
   `sendCutoverComplete`) and the broadcast UI is in Config → Skedda
   Cutover Broadcasts. **Don't** fire those without the operator's go-
   ahead on the date.

---

## Where things stand right now

### Live in production (HG)

- **~72 paying members** across Patron / Starter / Green Jacket /
  Unlimited. Counts live on Reports → Members.
- **47+ members onboarded on the new app** (post-launch-broadcast
  landing). Watch the "On App" KPI on Customers tab — it climbs as
  more members sign in.
- **Per-tenant Stripe webhooks** with self-heal on `checkout.session.
  completed` AND `invoice.paid` (Phase 7C + Rob Kim fix).
- **Public surfaces:** `/book` (availability + tier CTA funnel),
  `/app` (install explainer), `/join/<slug>` (tier shortcut links).
- **Public ProShop:** `/shop` (guest checkout, Stripe, Shippo
  shipping).
- **Payment-failed member flow:** Stripe `invoice.payment_failed` →
  branded email + Past Due chip on admin Customers tab.
- **Double-booking detection:** Skedda webhook compares against
  existing bookings; if overlap, flags both rows + emails admin +
  shows red CONFLICT banner on Today tab. Unblocks the transition.
- **Admin day timeline** (NEW this week): horizontal Gantt of the
  day above the per-bay list on Today tab. Clickable blocks open
  the edit sheet.
- **Email preview viewer:** `/api/email-preview/<slug>` renders any
  transactional email with fake sample data. Shareable URLs; see
  `docs/EMAIL_TEMPLATE_HANDOFF.md` for the designer workflow.
- **Launch broadcast shipped:** all 72 paying members received the
  branded "Meet the new Hour Golf app" email on 2026-04-23.

### Open items that might surface in admin workflow work

- **Cutover is scheduled but not fired** (see
  `docs/SKEDDA_CUTOVER_PLAN.md`). Until cutover day, double bookings
  from Skedda are caught by the webhook + banner — operator still
  has to call one member to resolve.
- **Unlimited tier (Alex Tadjedin duplicate):** member #7 and #73
  both listed as "Alex Tadjedin" with different emails. Minor data
  hygiene item, not urgent.
- **Broken header logo in emails was data-level**, not code. Code
  now filters non-absolute URLs and falls through. If a new tenant
  saves a relative path, emails still render (falls to welcome
  logo). In-app headers keep using the relative path as-is.

### Test harness

- `npm test` → **29 passing tests** (overage / feature-guard /
  platform-auth). Add `*.test.js` next to source files. Vitest picks
  them up.
- `npm run build` compiles cleanly. **Known local quirk:** page-data
  collection fails with `supabaseKey is required` because there's no
  `.env.local` in the working tree. Vercel builds fine — it's only a
  local dev-env gap.

---

## Scope guardrails for this session

### ✅ SAFE to edit freely (admin-only surfaces)

These files are rendered only for admins or are admin-only APIs.
Changes here can't reach a member.

**View components (admin dashboard is these):**
- `components/views/TodayView.js`
- `components/views/WeekView.js`
- `components/views/OverviewView.js`
- `components/views/CustomersView.js`
- `components/views/ConfigView.js`
- `components/views/DetailView.js`
- `components/views/ReportsView.js`
- `components/views/EventsView.js`
- `components/views/ShopAdminView.js`
- `components/views/SettingsView.js`
- `components/views/DayTimeline.js`
- `components/settings/*.js`
- `components/forms/*.js` (LoginForm, BookingForm, SyncModal)
- `components/layout/Header.js` (admin header)
- `components/layout/Nav.js` (admin nav)

**Hooks (admin only):**
- `hooks/useData.js` (admin data refresh loop)
- `hooks/useSettings.js`
- `hooks/useAuth.js` (admin auth)
- `hooks/useKeyboard.js`
- `hooks/useToast.js`

**Admin API routes:**
- `pages/api/admin-*.js` (everything prefixed `admin-`)
- `pages/api/platform-*.js` (platform admin only)
- `pages/api/stripe-lookup.js`, `stripe-charge.js`,
  `charge-nonmember*.js` (admin mutations)
- `pages/api/upload-*.js` (admin uploads — logo/font/shop/event)
- `pages/api/verify-member.js` (admin QR verify)
- `pages/api/send-email.js` (admin email test endpoint)
- `pages/api/backfill-subscriptions.js`

**Admin pages:**
- `pages/index.js` (the admin dashboard root)
- `pages/platform/*.js`

**Documentation, migrations, tests:**
- `docs/*.md`, `supabase/migrations/*.sql` (new migrations OK; don't
  edit past ones), `*.test.js`

### ⚠️ TOUCH WITH CARE (shared with members)

These files power admin AND member surfaces. Changes may affect
members — use feature flags, new functions, or careful edits.

**Shared libraries:**
- `lib/email.js` — admin AND member transactional emails. New
  templates OK; only change existing templates if you're also OK
  with the member-side rendering it.
- `lib/email-layout.js` — visual wrapper for every email.
- `lib/branding.js` — tenant branding loader + helpers (bay labels,
  cancel cutoff, etc.). Read-only from admin views is safe.
- `lib/format.js` — date/time/Pacific-bucket helpers. Widely used.
- `lib/overage.js` — billing math. Member dashboard + admin both
  consume. Widely tested.
- `lib/api-helpers.js` — `verifyAdmin`, `getTenantId`,
  `getServiceKey`. Never loosen.
- `lib/security.js` — CSRF + rate-limit + MIME validation. Don't
  weaken.
- `lib/supabase.js` — admin REST helpers (used by useData). Safe to
  refactor as long as members don't import from here.

**Shared UI primitives:**
- `components/ui/Modal.js`, `Toast.js`, `Confirm.js`, `Badge.js`,
  `TierSelect.js`, `SlideToConfirm.js`
- `components/DatePicker.js`

**Config:**
- `next.config.js`, `middleware.js`, `pages/_app.js`,
  `pages/_document.js`
- `styles/globals.css` — admin styles are in one region; member
  styles are in another. Grep before editing.

### 🚫 DO NOT EDIT (member-facing surfaces)

Any change here can force a member reload and potentially surface a
regression on the live member app.

**Member components + pages:**
- `components/members/*`
- `pages/members/*`
- `pages/app.js`, `pages/book.js`, `pages/shop.js`,
  `pages/portal.js`, `pages/verify.js`
- `pages/join/[tier].js`

**Member APIs:**
- `pages/api/member-*.js` (all 26 of them)
- `pages/api/customer-*.js`
- `pages/api/public-*.js`
- `pages/api/manifest.js`
- `pages/api/punch-pass-purchase.js`
- `pages/api/booking-webhook.js` (Skedda → us — member-consequential)

**Member service workers + PWA:**
- `public/sw.js`
- `public/manifest.json`

**Shared webhook handlers with member consequences:**
- `lib/stripe-webhook-handler.js` — fires member tier flips, welcome
  emails, past-due flags.
- `supabase/functions/process-access-codes/*` — sends door-code
  emails ~10 min before each booking.

---

## Likely admin-workflow improvement targets

Prioritized by what's been thumb-in-the-air during recent ops.

### Tier 1 — clear pain points observed

1. **Find-member flow.** There's no global search. CustomersView
   has a search box but navigating to a specific member first-time
   requires clicking through tabs. A `cmd+K` quick-command
   palette with member name/email/phone fuzzy-match → jump to
   DetailView would save minutes per day.
2. **Booking conflicts need an empty state.** The red banner on
   Today only renders when conflicts exist today. Viewing historic
   days doesn't surface past conflicts at all. Consider a
   "Conflicts" tab or inline banner on Week/Overview.
3. **Booking-row keyboard shortcuts.** Arrow keys don't move
   selection on TodayView. Missing quick-action model (e.g. select
   + shift-D to delete, shift-E to edit) that power users expect.
4. **Bulk actions only exist on TodayView.** CustomersView and
   DetailView don't have multi-select. Bulk-message, bulk-tier-
   change, bulk-tag would save time on large ops (e.g. "send this
   email to everyone who hasn't logged in").
5. **No activity log.** Who cancelled that booking? When did
   so-and-so get upgraded? There's no history — changes are
   observable only through their effect.

### Tier 2 — workflow quality-of-life

6. **Saved filters on Customers tab.** Operator repeatedly applies
   the same filter (Patron + paying + logged-in last 30d, etc.).
7. **Undo for destructive actions.** Cancel/delete a booking →
   toast with Undo button. 5-second window.
8. **Notes on members.** Private operator notes field on the
   member row ("allergic to corn chips", "prefers bay 3 left",
   etc.). DetailView-only; never exposed to member.
9. **Past-due dashboard.** A focused view for billing issues —
   who's past_due, for how much, last card-fail date, days until
   subscription auto-cancels. Separate from the Customers chip.
10. **Today-morning briefing.** A daily email to the operator at
    7am: today's bookings summary, any overnight conflicts,
    overdue shop-request follow-ups, past-due members.

### Tier 3 — polish and nice-to-have

11. **Mobile admin.** Operators occasionally work the phone while
    at the counter. TodayView + DetailView could use mobile-first
    layouts.
12. **Timeline zoom.** DayTimeline is currently fixed 6 AM–11 PM.
    Zoom to "next 4 hours" would pack more detail near the now line.
13. **Shop-request resolution workflow.** Each request has status
    transitions but no timer/escalation. An SLA warning ("this
    request is >7 days old") would help.
14. **Event attendee management.** EventsView shows events + RSVPs
    but no way to email/text all attendees at once.

### Tier 4 — measurements to consider

15. **Admin usage analytics.** Which tabs do operators use? Which
    actions take longest? Built-in Vercel Analytics could tag
    admin pageviews separately.
16. **Operator error surface.** When an admin action fails
    (Stripe-link failed, email send failed), failures should go to
    an admin "Issues" tab, not just Vercel logs.

---

## Rails to hold while working

- **Auto memory `lessons_db_migration_audits.md`**: audit ALL
  readers/writers before changing RLS, dropping columns, or altering
  shared tables. We've burned on this before.
- **Pacific-time bucketing** (`lib/format.pacificMonthWindow()`) is
  the contract for any monthly aggregation that touches member-
  visible numbers. Don't roll your own.
- **Service role key never touches the client bundle.** Double-check
  `grep -r SERVICE_ROLE components/ hooks/` comes back empty.
- **Admin writes go through API routes** (service-role on server),
  not direct PostgREST calls from the browser (those would hit RLS
  policies and potentially get blocked). The exceptions are
  `supa()` reads in `hooks/useData.js` — which hit RLS `admin_all`
  policies — don't add writes there.
- **Every admin API route** checks `verifyAdmin(req)` before doing
  anything. New routes inherit the pattern.
- **Tests pass before push.** `npm test` stays at 29 passing. Add
  a test next to any new shared logic.
- **Member reloads:** by deliberately scoping this session to admin
  files, members never need to hard-refresh. If you find yourself
  wanting to edit `components/members/*` or `pages/members/*` for a
  shared-logic reason, stop and confirm with the operator first.

---

## How to run + verify

```
npm install          # if node_modules is missing
npm run dev          # local dev server on :3000
npm test             # 29 tests, <1s
npm run build        # prod build (local fails on env vars; Vercel fine)
```

Deploy: `git push origin main` — Vercel auto-builds + deploys prod
in 2–3 min.

---

## Quick reference — the admin dashboard shape

`pages/index.js` renders the `<Dashboard>` component. State is:
- `view` ∈ { today, week, overview, customers, shop, tiers, reports,
  detail, settings, events }
- `selMember` (email), `selMonth`, various filters
- Modals: `addOpen`, `editBk`, `cancTgt`, `delTgt`, `chgTgt`,
  `syncOpen`

The `view` dispatches to the matching view component via
`next/dynamic` (code-split). TodayView is eager, others lazy.

**useData hook** (`hooks/useData.js`) auto-refreshes every 60s when
connected. Pulls: `members`, `bookings`, `tier_config`,
`monthly_usage`, `payments`, `access_code_jobs`. Uses the admin JWT
via `supa()`. RLS `admin_all` policies enforce tenant scoping.

**Header** (`components/layout/Header.js`): logo, today-count, hours,
member count, nav buttons, refresh. `useBranding()` → tenant colors.

**Nav** (`components/layout/Nav.js`): top-level tabs. Badge counts.

---

*Ready for admin workflow polish. Pick a tier-1 item, ship a tight
branch-per-feature, keep `git push` zero-member-impact.*
