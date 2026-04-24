# Next session handoff — admin PWA Phase 5 stretch

*Written 2026-04-24 at the end of the admin-PWA sprint
(commits 9456560 → 8d525dd, shipping Phases 1-5 of the PWA plan
plus billing discoverability + Shop e-commerce phases B-E).*

**Next session focus: three "app-feel" investments on the admin
PWA that the last session deliberately stopped short of.** All
three are mobile-targeted, all independent, all optional. Pick one,
all three, or none depending on what feels most valuable to the
operator by the time the session runs.

---

## Read these first (in order)

1. **This file** — orientation + task scope + guardrails.
2. **Auto-memory `MEMORY.md`** — especially:
   - `project_admin_pwa_plan.md` — the 6-phase PWA plan. Phases 1-5
     shipped in the 2026-04-24 session; Phase 6 (offline + biometric)
     explicitly skipped.
   - `lessons_db_migration_audits.md` — audit all readers/writers
     before tightening anything on shared tables.
   - `feedback_staged_verification.md` — split non-trivial work into
     phases, smoke-test between each.
3. **`docs/HG_IMPROVEMENTS.md`** — shipped log + open items.
4. **`docs/SKEDDA_CUTOVER_PLAN.md`** — cutover scheduled for
   **Mon May 11, 2026**, not yet executed. Don't fire the cutover
   broadcasts without operator sign-off on the date.

---

## State of the admin PWA (2026-04-24)

Installable at `/admin` as "HGC Office" — separate manifest + SW
(scope `/admin/`, cache `hgc-admin-v*`) from the member PWA (scope
`/members/`, cache `hourgolf-v*`). Both coexist on one origin.

Bottom-tab nav on mobile (Today / Inbox / Members / More); top tabs
on desktop. Inbox aggregates conflicts + past-due + non-members-to-
charge + low-stock with count badge on the tab. Push notifications
wired with 4 triggers: new booking, conflict, past-due flip,
new member signup. VAPID keys live in Vercel env (VAPID_PUBLIC_KEY,
VAPID_PRIVATE_KEY, VAPID_SUBJECT).

Billing discoverability solved — $ amounts live on the Customers
chip faces and in the KPI strip so the operator sees the monthly
billing load at a glance without clicking.

Mobile polish across Today (stacked booking rows, timeline hidden,
36px tap targets), Customers (chip tap targets, card breathing
room), Detail (wrapping table rows).

Everything above landed across ~25 commits in the 2026-04-24
session. `npm test` green at 39 tests; `npm run build` compiles
cleanly (local page-data collection still fails on missing
`.env.local` — known quirk, Vercel fine).

---

## What's next — three stretch investments

Each is an independently shippable chunk. Listed in rough
descending effort / impact:

### Stretch 1 — Bottom-sheet DetailView on mobile (biggest)

**Problem:** tapping a member on Customers currently navigates to
the Detail tab, replacing the whole view. On mobile the transition
feels like a page load (because it effectively is), and hitting the
Customers nav tab to get "back" loses the customer context
entirely. App-shaped behavior: tap a customer → half-height bottom
sheet slides up with Detail; swipe-down or tap-away to dismiss;
Customers list is still visible underneath.

**Target files:**
- `pages/admin/index.js` — the view dispatcher. Currently reacts
  to `view === "detail"` and renders DetailView full-width. The
  `selMember` state + `selectMember` callback already exist.
- `components/views/DetailView.js` — the component itself. 408
  lines, scrollable stack of cards. Should render inside the sheet
  with minimal changes — maybe drop the outer padding.
- `components/ui/Modal.js` — existing React-portal modal. Not a
  sheet but the portal pattern is close. Might extend or write a
  new `<Sheet>` component modelled on it.
- `styles/globals.css` — `@media (max-width: 768px)` block starts
  around line 746.

**Approach sketch:**
- Add `<Sheet>` (new file: `components/ui/Sheet.js`) that portals
  children, slides up from the bottom, pins to `calc(100vh -
  env(safe-area-inset-top))` height, has a drag-handle + close
  button. Desktop ignores it (same as current Detail behavior).
- On mobile, when `view === "detail"` AND `selMember` exists,
  render `<Sheet open><DetailView ...></Sheet>` and DON'T render
  the full-width DetailView.
- Use `useMediaQuery` or `matchMedia` to detect mobile. There's no
  existing hook — add `hooks/useIsMobile.js` returning a stable
  boolean (SSR-safe, defaults to false until first effect).
- URL state: keep `?view=detail` as-is so back-button + deep-links
  still work. Closing the sheet should reset `view` to `"customers"`
  and clear `selMember`.
- Swipe-down-to-dismiss is nice-to-have; a close button covers 80%
  of the value for half the effort.

**Risks:**
- `pages/admin/index.js` is the big file (650 lines). Be surgical.
- Existing desktop Detail behavior must not regress — test both
  viewports via the preview tool.
- Scroll position inside DetailView when the sheet opens: the
  operator expects Top on first open, but on "reopen after closing"
  maybe remember. Not critical; document as a follow-up.

**Effort estimate:** 2-3 hrs. One commit, gated behind viewport.

### Stretch 2 — Swipe-to-action on booking rows (medium)

**Problem:** on mobile the slot rows have Edit + Cancel buttons
stacked next to the customer name. Fine, but cramped. Native apps
typically expose per-row actions via swipe. Swipe left on a
booking row → reveal red Cancel; swipe right → reveal blue Edit.
Threshold commit runs the action; below threshold snaps back.

**Target files:**
- `components/views/TodayView.js` — booking slots at lines ~403-448
  (the `<div className={\`slot \${st} ...\`}>` render).
- `components/views/DetailView.js` — similar slot rendering for the
  member's bookings list.
- `styles/globals.css` — `.slot` styling (line 268+).

**Approach sketch:**
- Don't pull in a library. Touch events + CSS transforms ≈ 60
  lines. Wrap each `.slot` in a `<div className="slot-swipe">`
  that owns `onTouchStart/onTouchMove/onTouchEnd`. Track the x
  delta; on move, translate the inner `.slot` by the delta;
  reveal Edit on positive delta, Cancel on negative; commit at
  ±80px; snap back with a CSS transition on release.
- Mobile-only: no-op the handler above 768px or don't attach in
  desktop (feature-detect via a `useIsMobile` hook — same one
  Stretch 1 wants).
- Keep the inline Edit/Cancel buttons around on mobile for
  accessibility — swipe is nice but must never be the only path.
- Respect the checkbox: swipe shouldn't fire if the operator has
  started multi-select mode (any row selected).

**Risks:**
- Touch events on iOS conflict with vertical scroll. The pattern
  is: capture the initial touch X/Y; only hijack the gesture if
  horizontal delta > vertical delta after a few px; otherwise
  release to the browser for normal scroll. Any library will do
  this for you; rolling your own requires this exact logic.
- Left-handed operators: swipe direction-for-action is a learned
  convention. Match iOS Mail (swipe left = danger). Don't invent.

**Effort estimate:** 3-4 hrs with careful touch-handling. One
commit.

### Stretch 3 — Pull-to-refresh on Today (smallest)

**Problem:** refresh lives on a hidden FAB (↻) that got removed
from the mobile layout entirely. Operator currently has no way to
force a data refresh on mobile outside the 60-second auto-interval
in `useData`. Pull-down-to-refresh is the iOS/Android native
gesture; it should work on TodayView (at minimum).

**Target files:**
- `pages/admin/index.js` — `refresh` callback exists from
  `useData` (line ~47). Pass it down.
- `components/views/TodayView.js` — the wrapper that would register
  touch events.
- `styles/globals.css` — new `.ptr-indicator` visual.

**Approach sketch:**
- Scope to TodayView first. If it feels right, add to Customers +
  Inbox later.
- On mobile only: attach `onTouchStart/Move/End` to the content
  wrapper. Only activate when `scrollTop === 0` at touchstart.
  Track pull distance; at 60px show indicator; at 100px trigger
  `refresh()` on release.
- Show a circular spinner or a "Release to refresh →" text chip
  during the pull.
- Debounce: ignore subsequent pulls within 2s of the last refresh.
- Desktop: no-op (no touch events, the existing desktop refresh
  FAB at the top nav is fine).

**Risks:**
- Low. Isolated to TodayView, no shared UI changes. Easy to
  feature-flag if it annoys the operator.

**Effort estimate:** 1-1.5 hrs. One commit.

---

## Scope guardrails (unchanged from prior handoff)

### ✅ SAFE to edit freely (admin-only)

- `components/views/TodayView.js`
- `components/views/DetailView.js`
- `components/views/CustomersView.js`
- `pages/admin/index.js`
- `hooks/*.js` for new admin-only hooks (e.g. `useIsMobile.js`)
- `components/ui/Sheet.js` (new, admin-only)
- `styles/globals.css` — admin rules only; grep for `.mem-*` class
  prefixes to spot member-side rules before editing them.

### ⚠️ TOUCH WITH CARE

- `components/ui/Modal.js` — shared with members. Don't break it;
  either extend or clone as `Sheet.js`.
- `hooks/useData.js` — member-app data loading passes through the
  same hook. Adding a "force refresh" path should be fine (it
  already takes a `refresh` callback), but don't change the polling
  interval.
- `public/admin-sw.js` — only bump the cache name if you change
  behavior; bump triggers the "update available" banner on already-
  installed admin PWAs.

### 🚫 DO NOT EDIT

- `components/members/*`, `pages/members/*`, `pages/api/member-*.js`
- `pages/api/booking-webhook.js` (receives Skedda writes —
  touched this session to add a push trigger; don't expand the
  surface further)
- `lib/stripe-webhook-handler.js` (also touched for push; leave
  alone beyond that)
- `public/sw.js` / `public/manifest.json` (member PWA)

---

## Rails to hold while working

- **Desktop must not regress.** All three stretches are mobile-
  only. Every change should be gated behind `@media (max-width:
  768px)` in CSS or a mobile-detection hook in JS. Verify via
  `preview_resize` at both 375-wide mobile and 1280-wide desktop
  before committing.
- **Member PWA must stay untouched.** Grep your changes for any
  file under `components/members/` or `pages/members/` and the
  shared SW/manifest. If something's there, stop.
- **Verify via the preview tool, not just `npm test`.** The mobile
  polish shipped this session was verified via `preview_resize` +
  DOM inspection, not visual-only. Assertions about
  `getComputedStyle` on fake elements are strong evidence rules
  are wired.
- **Admin credentials aren't in this environment.** The preview
  tool can render the login page + any public route but cannot get
  past auth. Test authenticated-view changes by:
  1. DOM-inspecting CSS rules on synthetic elements (see the last
     session's commit messages for examples).
  2. Pushing to prod and testing on-device after Vercel deploys.
  - If a change is impossible to verify pre-push, say so in the
    commit message + verify on-device right after the push.
- **Staged commits, push between phases.** Shipped pattern last
  session: one commit per stretch, push after each green. Hour Golf
  is live production with ~72 paying members.

---

## How to run + verify

```
npm install                   # if node_modules is missing
npm run dev                   # via the preview tool, NOT Bash
npm test                      # 39 tests, <1s
npm run build                 # local fails on env vars, Vercel fine
```

Preview tool launch config lives at `.claude/launch.json`
(gitignored — regenerate if missing by pointing the preview tool
at `npm run dev`). Use `preview_resize` to toggle between 375-wide
mobile and 1280-wide desktop when verifying responsive rules.

Deploy: `git push origin main` — Vercel auto-builds + deploys prod
in 2-3 min.

---

## Quick reference — useful context

**Admin URL structure:**
- `/` — 307-redirects to `/admin` (query preserved)
- `/admin` — admin Dashboard root (login or authenticated view)
- `/admin?view=today` — default landing after login
- `/admin?view=inbox` — attention-signals hub
- `/admin?view=customers` — member list with billing chips
- `/members/*` — member PWA (untouched, different scope)

**Admin state shape (pages/admin/index.js `<Dashboard>`):**
- `view` ∈ { today, week, customers, events, shop, tiers, reports,
  inbox, detail, settings }
- `selMember` (email) — when set, Detail opens
- `viewDate` (ISO) — when set, Today/Week show a historic day
- Various filter + modal states.

**useData hook** polls every 60s when connected. Returns:
`members`, `bookings`, `tierCfg`, `usage`, `payments`,
`accessCodes`, plus the `refresh` callback.

**Mobile breakpoint convention:** `@media (max-width: 768px)` for
layout changes. `600px` for minor tweaks (existing, don't
redefine without reason). `400px` for very narrow polish.

**Viewport-aware JS:** no existing `useIsMobile` hook. Create one
at `hooks/useIsMobile.js` if any stretch needs it — SSR-safe
shape (returns `false` on server, reads `window.matchMedia` on
mount).

---

*Ready for Phase 5 stretch work. Pick an item, branch-per-feature
if you want separable reverts, push green. Phase 6 (offline +
biometric) remains deferred per the project_admin_pwa_plan memory
— only reconsider if the operator has actively hit an offline
pain.*
