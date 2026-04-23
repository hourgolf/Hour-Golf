# Claude Design brief — what a design-focused session could tackle

*Written 2026-04-23 alongside `NEXT_SESSION_HANDOFF.md`. This doc is
for a session where the primary goal is design review, brand
consistency, or UX polish — rather than shipping new features. Pair
with the `docs/EMAIL_TEMPLATE_HANDOFF.md` designer workflow if that
touches the same surfaces.*

---

## Where design attention would move the needle most

Ranked by impact-per-hour, based on what's shipped and what a typical
member / admin spends time looking at.

### 1. Member dashboard hero (highest visibility)

`components/members/MemberDashboard.js` + referenced CSS classes in
`styles/globals.css` (search `mem-dashboard`, `mem-hero`, etc.).

Every member sees this surface multiple times a week. Current state
is functional but hand-rolled — slide-to-extend, live door code card,
progress bar, event pop-up, news banner, install prompt. All coded
individually without a unified spacing/rhythm.

**Tasks a design session could take on:**
- Audit the hero's visual hierarchy. What should the eye land on
  first (probably: next-booking + live door code, or empty-state
  "Book a bay" CTA)?
- Spacing grid — right now margins/paddings are ad-hoc. A 4px /
  8px / 12px / 16px / 24px rhythm would reduce visual noise.
- Type scale — the dashboard uses 4+ font sizes without an
  obvious system. Consolidate to a 4-step scale.
- Mobile review. Hero is primarily mobile; re-verify on iOS Safari
  + Android Chrome at 360px / 390px / 430px widths.

### 2. Admin theme consistency

The admin dashboard accumulated 10+ views over several months.
Visual treatment drifted across them:
- Some views use `.sum-item` KPI cards, others use inline divs with
  different spacing.
- `Badge` component is used inconsistently (different sizes,
  sometimes with inline styles overriding).
- Button variants: `.btn`, `.btn primary`, `.btn danger`,
  `.mem-btn-sm` — some views mix them, some use inline button
  styles.
- `section-head` is the consistent pattern for admin sub-section
  titles, but not every view uses it.

**Tasks:**
- Identify the 5–8 components that should become first-class in
  `components/ui/` — KpiCard, Chip, ActionRow, DataTable header,
  SectionHead, etc.
- Audit every `style={{...}}` inline block in `components/views/*`.
  The ones that repeat → promote to a class or shared component.
- Normalize button + chip variants. Today there's `badge`,
  `badge-sm`, inline-style pills, the `today-conflict-banner-row`
  one-offs. One Chip component with size + tone props would collapse
  most of these.

### 3. Transactional email template redesign

11 transactional templates + the cutover/launch broadcasts all share
`lib/email-layout.js`. Designer-handoff workflow is documented in
`docs/EMAIL_TEMPLATE_HANDOFF.md`. Preview URLs at
`/api/email-preview/<slug>` let a designer review + propose changes.

**Tasks a designer can do now** (without code changes):
- Review every preview, annotate in Figma with changes.
- Deliver revised HTML files (`?raw=1` on any preview URL returns
  plain HTML).

Tasks a design-focused Claude session could do:
- Propose a unified email-header design (right now it's the clubhouse
  PNG at 96px max-height).
- Improve the detail box / CTA button spacing rhythm.
- Propose brand typography for subject lines + preheaders.
- Mobile-first audit — many recipients read email on phones.

### 4. Color system formalization

CSS variables are set in `lib/branding.js` (injected via
`_document.js`) + `styles/globals.css`. Today:
- `--primary`, `--accent`, `--danger`, `--cream`, `--text`,
  `--text-muted`, `--surface`, `--border`, `--bg`
- Plus tenant-overrideable per-tier colors (`--tier-patron`, etc.)
- Plus tier-color JSONB in `tenant_branding.tier_colors`

**Gaps:**
- No neutrals scale (gray 50 / 100 / 200 / 300… / 900 pattern).
- No semantic tokens (`--color-success` vs `--color-primary` —
  these happen to be the same green today but shouldn't be forever).
- Dark mode is not implemented. Some surfaces have `color-scheme:
  light` hints, others don't.
- Contrast ratios unchecked. `--text-muted` on `--bg` may fail WCAG
  AA on some screens.

**Tasks:**
- Design a Tailwind-style semantic-token layer over the existing
  brand variables. Would fall back to the current HG values if not
  set per-tenant.
- Dark mode spec. Email templates already declare light-only; the
  admin + member app are unspec'd.
- Accessibility contrast audit.

### 5. Icon consistency

The app uses emoji throughout for quick visual markers (📅 🔑 🛍️ ⭐
💳 etc). It's friendly but not scalable for multi-tenant (not every
venue wants golf-vibe emojis). A design session could:
- Propose a minimal SVG icon set (24 / 32 / 48px) for the most-used
  markers.
- Migrate from emoji → icons on admin first, keep member emoji until
  a per-tenant theme system is ready.

### 6. Component library polish

`components/ui/` currently has:
- `Modal.js` (React Portal — bumped so stacking contexts don't
  break it)
- `Toast.js`
- `Confirm.js`
- `Badge.js`
- `TierSelect.js`
- `SlideToConfirm.js`

These are working but stylistically diverse. A design session could:
- Audit each for API consistency (all take `size`, `tone`, etc.?).
- Consolidate naming and create a `components/ui/README.md` for
  documentation + a mini demo page at `/ui-kit` (admin-only).
- Build missing primitives that repeat across views: Card,
  EmptyState, DataTable, SegmentedControl.

### 7. Empty states + onboarding moments

Most list views have a terse empty state ("No bookings") or none at
all. First-time user feelings:
- New admin opens TodayView on a slow day → "No bookings" text, no
  reassurance or quick-action
- Member opens Pro Shop empty → no personality
- Zero events on EventsView → no "schedule your first event" CTA

Design session tasks:
- Audit every empty state — is it terminal or does it invite an
  action?
- Mock up improved empty states with illustrations / CTAs.

---

## Good tools for a design-focused Claude session

### Preview URLs to share

Every transactional email renders at:
```
<portal>/api/email-preview/<slug>
```

Slugs: `booking-confirmation`, `booking-cancellation`, `access-code`,
`welcome`, `payment-receipt`, `payment-failed`, `password-reset`,
`launch`, `shop-request-admin`, `shop-request-ready`,
`shop-order-notification`, `shipment-delivered`, `cutover-
announcement`, `cutover-reminder`, `cutover-complete-member`,
`cutover-complete-new`, `booking-conflict-alert`.

Append `?raw=1` to get the bare HTML for a designer to take local.

Public pages at:
- `<portal>/book` (prospect landing + availability)
- `<portal>/app` (install explainer)
- `<portal>/shop` (public pro shop)
- `<portal>/join/<slug>` (tier shortcut → Stripe Checkout)

### Figma/mockup-driven work

A design session can:
1. Grab screenshots of current state (admin surface behind login;
   public surfaces work without).
2. Mark up in Figma with annotations ("logo 20% smaller", "swap teal
   for #2E5D47", copy changes).
3. Hand a Figma link + annotations back to a code-focused session
   for implementation.

### Code-light tasks

A design-focused Claude session can also:
- Propose and apply pure CSS changes (spacing, typography, color
  variable tweaks).
- Build new `components/ui/*` primitives with Storybook-style
  demos.
- Write a `docs/DESIGN_SYSTEM.md` with token names, usage guidance,
  component API docs.
- Audit contrast ratios and propose color adjustments.

---

## What a design session should NOT touch without operator sign-off

- **Member-facing copy** that's deployed. Change the wording on
  `/app`, `/book`, the member dashboard, or any member email and
  real members see it next time they load. Propose + get OK first.
- **The brand palette values on live tenants.** `tenant_branding`
  rows are tenant-owned. Changing `--primary` globally changes how
  HG looks.
- **Destructive CSS refactors on `styles/globals.css`.** The file is
  1700+ lines and has been hand-maintained. Any sweeping removal
  risks orphaning a class someone uses. Safer: add new classes,
  migrate to them view-by-view, retire the old on a separate pass.

---

## Deliverables a designer-focused session should leave behind

1. **A design audit doc** — every surface reviewed, pain points
   called out, recommended changes prioritized.
2. **A Figma file or screenshots with annotations** (if visual-
   first) OR a tight branch with CSS/component changes (if code-
   first).
3. **A `docs/DESIGN_SYSTEM.md`** (if the work is systematic) —
   tokens, component API, usage examples.
4. **Updated `styles/globals.css` with a clear region comment** so
   future sessions can find the design-system region separately
   from the view-specific CSS.

---

## Project pointers (so a design session doesn't have to hunt)

- **Brand source:** `lib/branding.js` — FALLBACK_BRANDING object
  has every default + tenant override path.
- **CSS vars injection:** `pages/_document.js` (SSR) writes
  `window.__TENANT_BRANDING__` + sets `:root` CSS variables.
- **Email wrapper:** `lib/email-layout.js` — renderEmailLayout +
  palette + renderButton + renderDetailBox.
- **UI components:** `components/ui/*`.
- **Admin views:** `components/views/*`.
- **Member views:** `components/members/*`.
- **Pages:** `pages/*`.
- **Fonts:** Served from Supabase Storage; declared via
  `lib/branding.js:buildDisplayFontFace()` as `@font-face` in SSR.

---

*Pair this with `NEXT_SESSION_HANDOFF.md` — that doc is
functionality-first, this one is design-first. Either can run in
parallel without conflict as long as the design session stays in the
component + CSS layer and the functionality session avoids
refactoring the same components.*
