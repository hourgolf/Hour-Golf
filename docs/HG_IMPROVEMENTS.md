# Hour Golf Improvements — Intake

*Started 2026-04-18. Single source of truth for every polish/fix/feature idea
before the member app launch. Dump items here as they come up — don't trust
memory. Items graduate out of this doc into commits, not the other way around.*

---

## How to use this doc

1. **Capture first, categorize second.** Drop a one-liner into the Inbox
   whenever something occurs to you. Don't stop to classify.
2. **Triage in batches.** Once a week (or when Inbox > ~10), move items into
   the categorized sections below with their schema filled in.
3. **Pull into sessions by theme, not by priority list order.** A theme is 5–12
   related items touching the same surface. See `NEXT_SESSION_HANDOFF.md` §2.
4. **Mark done inline.** Strike through (`~~text~~`) or move to the Shipped
   log at the bottom with the commit SHA. Don't delete — the history is useful.

### Entry schema

```
- [ ] [Surface] [Size] [Type] [Priority] — one-liner
      Notes: optional context, reproduction, or sketch
```

- **Surface**: `member` | `admin` | `shared` | `mobile` | `email` | `pwa`
- **Size**: `trivial` (<5 min) | `small` (~30 min) | `medium` (~2 hrs) | `big` (session+)
- **Type**: `bug` | `cosmetic` | `ux` | `feature` | `launch-blocker`
- **Priority**: `P0` (broken) | `P1` (weekly pain) | `P2` (nice) | `P3` (someday)

Example:

```
- [ ] [member] [small] [ux] [P1] — Booking confirmation doesn't show the bay number on mobile
      Notes: reported by J. on 2026-04-15; lives in pages/members/bookings/[id].js
```

---

## Inbox (uncategorized — dump here first)

Member Booking flow improvement

-Mobile calendar field still shows bookings more than 7 days out, but when you press it defaults to 7 days away. This looks confusing and members might think they can book/did book without checking.

-a way to click/press>hold and drag to select the booking times you want, rather than clicking the start time grid box, going back to the top and changing times in fields. This is how skedda looks on desktop: (see screenshot), if this is not feasible/elegant on mobile, a tap on a booking time should return you back to the booking fields on top to make a adjustments, or open a pop up that lets members fine tune the booking (select bay(s), adjust time [with constraints in place, constraints will be adjustable by admin]add guests, remind of cancellation window/policy, explainer of how access code will be delivered/used, contact for booking cancellations/edits, accept terms and confirm booking)

-more prominent booking confirmation toast. Currently very hard to miss and then the booking field shows a red error ready that time is filled. Its confusing.

---
SURFACE: member home page/account + admin customer DB SIZE: big
TYPE: functional
Explainer: We have a feature where members can show a QR code to connect their in person account/discounts with their app dashboard. Right now those QR codes are generic but could be sync with Square POS. Read this page to understand how that would work. Seems like adding a silent square reference #table and finding a way to generate a unique QR code for each member. 
PRIORITY: medium

## Themes

Sessions group items by theme. Order within a theme: **bugs → ux → cosmetic → features**.

### Theme: Member booking flow

*The path from open portal → book a bay. Highest-leverage surface.*

- [ ] [mobile] [small] [ux] [P1] — Hide inline `.mem-book-form` on mobile; tap-grid + sheet only. Removes the double-pathing.
- [ ] [member] [small] [ux] [P2] — Sticky date pill on the availability grid so date stays visible while scrolling.
- [ ] [member] [medium] [feature] [P2] — Persist Terms acceptance (set `members.terms_accepted_at` on signup; drop the per-booking checkbox). Add a `require_per_booking_consent` tenant flag for clubs whose legal counsel insists.
- [ ] [member] [trivial] [ux] [P2] — Tappable "Need to change something?" line in the booking sheet (mailto:/tel: from branding, mirrors the dashboard pattern).
- [ ] [member] [small] [ux] [P3] — Auto-scroll the availability grid to the next open slot near "now" on load.

### Theme: Admin Today + Calendar

*The screens the operator lives in every day.*

- [ ]

### Theme: Email copy + design

*Every transactional email is a member-brand touch. Batch — shared template layer.*

Templates to audit (from `lib/email.js`):
- Booking confirmation
- Booking cancellation
- Access code delivery (10-min pre-booking)
- Welcome / onboarding
- Payment receipt
- Overage charge
- Subscription renewal / failure
- Event RSVP confirmation
- Punch pass purchase receipt

- [ ]

### Theme: Pro shop UX

*Revenue surface when HG runs drops.*

- [ ]

### Theme: Mobile-first polish

*Bookings + access codes are primarily mobile. Verify on real iOS + Android.*

- [ ] [mobile] [medium] [feature] [P2] — Bottom-tab nav on mobile (true PWA app-feel). Six items fit; rare items (Billing) collapse into Account.
- [ ] [member] [small] [ux] [P2] — News/event popup snooze (currently only "Got it" forever-dismiss). Add "remind me tomorrow."
- [ ] [member] [small] [ux] [P2] — Tab nav on mobile: fade gradient on the right edge so members realize Account/Billing scroll into view.
- [ ] [member] [trivial] [cosmetic] [P3] — Header on mobile: drop member # (it lives on the QR + Account pages); keep name + tier dot only.

### Theme: PWA install + launch

*See `NEXT_SESSION_HANDOFF.md` §3 for the launch plan.*

- [ ] [pwa] [medium] [launch-blocker] [P0] — Build `/app` install surface with iOS + Android + desktop walkthroughs
- [ ] [pwa] [small] [launch-blocker] [P0] — "Update available" banner that calls `registration.update()` and reloads
- [ ] [email] [small] [launch-blocker] [P0] — Launch email to ~80 HG members with install instructions + why

### Theme: Admin efficiency (daily ops)

*Small reductions in clicks/time for the operator. High compounding value.*

- [ ]

### Theme: Multi-tenant readiness

*Surfaces still hardcoded to HG that block clean tenant onboarding.*

- [ ] [shared] [medium] [feature] [P2] — Tenant-configurable cancel cutoff (`tenant_settings.cancel_cutoff_hours`). Currently hardcoded at 6h in MemberDashboard.
- [ ] [shared] [medium] [feature] [P2] — Tenant-configurable bay noun (`tenant_settings.bay_label`). Squash courts? Sim lounges? Swim lanes?
- [ ] [shared] [medium] [feature] [P3] — Per-tenant tier coloring — `TIER_COLORS` is HG-baked. Move into `tenant_branding` or a dedicated tier table.

### Theme: Loyalty / subscriptions / punch passes

*Revenue-adjacent. Low daily traffic but must feel right.*

- [ ]

---

## Out of scope (parked, not forgotten)

Items that are real but don't belong in this sprint. Revisit after member launch.

- Platform billing Phase 2 — wire Ourlee's own Stripe account. Blocked on business model decision. See `docs/OURLEE_BUSINESS_OVERVIEW.md`.
- `booking-webhook.js` cleanup — blocked on Skedda/Zapier sunset.
- `monthly_usage` SECURITY DEFINER → INVOKER — 2-hour focused task, do when nothing else is in flight.
- Phase 7C-3 Stripe webhook shim delete — pending observation window.
- Tier 2 scalar columns drop on `members` — pending soak time.
- App Store presence (Capacitor wrap) — reconsider at >200 members.
- Push notifications — nice-to-have, 1–1.5 sessions. Queue after PWA install lands.
- Second-tenant onboarding polish — no real second tenant yet.
- Platform `/platform/*` UI tweaks — paused per 2026-04-18 focus shift.

---

## Shipped

*Move completed items here with commit SHA and date. Append-only log.*

<!-- Example:
- 2026-04-20 `abc1234` — [member] Booking confirmation shows bay number on mobile
-->

- 2026-04-19 `e3a0672` — [member] Dashboard: next-booking hero + countdown + access-code copy
- 2026-04-19 `e3a0672` — [member] Dashboard: three redundant usage cards → single progress bar with chip row
- 2026-04-19 `e3a0672` — [member] Dashboard: QR moved to "Show code" pill; lazy-loaded only on modal open
- 2026-04-19 `e3a0672` — [member] Dashboard: "Contact us to cancel" becomes tappable mailto:/tel: from branding
- 2026-04-19 `e3a0672` — [shared] Status colors via CSS vars (`--status-good/warn/danger/bonus`) with HG fallbacks
- 2026-04-19 `e3a0672` — [member] Dashboard: empty-state hero with "Book a bay" CTA when no upcoming bookings
- 2026-04-19 `e3a0672` — [member] Dashboard: loyalty section explainer + "$X credit" wording
- 2026-04-19 `e37322b` — [member] Booking: success panel after submit (kills post-booking red-error flash)
- 2026-04-19 `e37322b` — [member] Booking: 7-day window hint inside the sheet
- 2026-04-19 `e37322b` — [member] Booking: tappable "Need to change something?" link in sheet
- 2026-04-19 `e37322b` — [mobile] Booking: hide inline form on mobile (sheet-only path)
- 2026-04-19 `e37322b` — [member] Booking: sticky day-bar above the availability grid

**Decisions / removed:**
- "Repeat last booking" chip — shipped briefly in `e37322b`, removed in next commit. No one was going to use it; just added clutter.

---

*Ready to start. Dump items into the Inbox and we'll triage in batches.*
