# Skedda → new-portal cutover plan

Written 2026-04-22. Goal: retire Skedda as a booking surface on a
specific date so there's a single source of truth for availability,
eliminating the double-booking risk that emerged 2026-04-22.

---

## Recommended timeline (14-day runway)

Pick a **Monday** as the cutover date — gives the operator a full work
week to handle any first-day stragglers without weekend chaos.

Suggested: **Monday, May 11, 2026** (next-next Monday from today).
Adjust in the admin UI when you broadcast.

| Day | Date | Action |
|---|---|---|
| **T−14** | Mon Apr 27 | Send **announcement** email to all paying members |
| T−7 | Mon May 4 | Watch the "On App" KPI climb past 40/72; hand-nudge stragglers in person |
| **T−3** | Fri May 8 | Send **T−3 reminder** email to members who still haven't logged in |
| **T=0** | **Mon May 11** | Cutover day — disable Skedda/Zapier, send **post-cutover** email |
| T+1 | Tue May 12 | First full day on single system — watch for support requests |
| T+7 | Mon May 18 | Retrospective; delete legacy webhook code if clean |

**Why 14 days?** Every member needs ~2 minutes to log in once and set
a password. At 72 paying members you can't expect 100% compliance in
under two weeks. 14 gives stragglers time + a reminder touchpoint.

---

## The three emails (copy ready to send)

Every email lands on `/members` — the sign-in page — per your last
adjustment to the launch flow. All three templates ship in
`lib/email.js` and have preview URLs (`/api/email-preview/cutover-*`)
so you can eyeball before broadcasting.

### 1. Announcement (T−14)

**Subject:** `Big change: Skedda is closing on <date>` — the real date
is templated in per broadcast.

**Key messages:**
- *What's happening:* Skedda retires on [DATE]. Every booking from
  that day forward happens in the new Hour Golf app.
- *Why:* One system = no more confused double-bookings, live door
  codes on your phone, pro-shop in-app, membership self-serve.
- *Exactly what you need to do:*
  1. Open [portal-url] on your phone.
  2. Tap **Sign in** and use the email we have on file (`<their-email>`
     is embedded in the email for zero ambiguity).
  3. First time? Enter anything for the password; the app walks you
     through setting a real one.
  4. New member with no booking history? You'll see a **Create
     account** button after trying — tap that.
- *Deadline copy:* "Do this before [DATE]. After that day, Skedda
  stops accepting new bookings — your only way to reserve a bay will
  be through the app."
- *Friendly offer:* "Stuck? Reply to this email — a human reads every
  response."

### 2. T−3 reminder (sent Fri May 8 if cutover is May 11)

**Subject:** `3 days until Skedda closes — have you logged in yet?`

**Target audience:** Only paying members with `first_app_login_at IS
NULL`. The broadcast endpoint filters to "hasn't logged in yet"
instead of "hasn't been emailed yet" so people who already onboarded
don't get this nag.

**Key messages:**
- *What's changed since last email:* You haven't logged in. Here's
  why it matters.
- *Countdown:* "On [DATE], 3 days from now, Skedda will stop taking
  bookings. If you haven't set up your Hour Golf app login by then,
  you won't be able to book bays until you do."
- *Action, once more:* Same 3-step Sign In block from the
  announcement, shorter form.
- *Personal touch:* "If email setup is the hang-up, reply — we'll
  walk you through it over text or phone."

### 3. Post-cutover / day-of (sent Mon May 11)

**Subject:** `Skedda is now closed — everything lives in the app`

**Target audience:** All paying members. Two variants embedded in the
template — one paragraph for members already on the app, another for
those not yet. Client-side render decides based on
`first_app_login_at` presence.

**Key messages:**
- *For members already on the app:* "You're all set. Nothing changes
  for you — just stop opening Skedda."
- *For members not yet on the app:* "You need to log in today to book
  your next session. Last-chance link here." Same 3-step block.
- *What to expect going forward:* Live door codes, calendar invites,
  pro shop, one-tap cancellation, etc.
- *Thank-you note:* Closes the transition on a positive.

---

## Day-of checklist (Mon May 11 morning)

Before sending the post-cutover email, do these in order:

- [ ] **Turn off the Zapier Zap** that relays Skedda → our webhook.
      Zapier Dashboard → find the Skedda booking Zap → flip to Off.
- [ ] **Lock Skedda down.** In Skedda admin, either (a) remove the
      member-facing booking page entirely, or (b) block all new
      reservations (members-only option in Skedda settings). Existing
      future bookings finish out through the Zapier-fed data we
      already have. New ones shouldn't be possible.
- [ ] **Verify the admin dashboard Today + Week still show existing
      Skedda-era bookings** for the rest of the week. Nothing should
      disappear — we already ingested them. Spot-check the next 5
      days in the admin.
- [ ] **Verify no pending conflicts.** Config → Today tab → if any
      red CONFLICT banners are showing, resolve before closing the
      bridge.
- [ ] **Send the post-cutover email** via Config → Cutover
      Broadcasts → "Send post-cutover" button.
- [ ] **Post an Instagram story** pointing at `<portal>/book` — social
      traffic that day goes straight to the new flow.

---

## What to watch for (first 24 hours)

- **Member support emails** about the transition. Most will be "I
  forgot my password" (they can't use Forgot Password because they
  never had a password; tell them to enter any password and the
  Complete Account flow kicks in).
- **Double-booking alerts.** These should DROP to zero after cutover
  since Skedda is no longer writing. If one still shows up, it's a
  late-arriving Zapier job — worth investigating why.
- **"On App" KPI** on Customers tab. Target: 60+/72 by end of day.
  The 10 or so stragglers get a personal text from you.
- **Booking volume.** Compare Mon May 11 vs Mon May 4 (same weekday
  previous week). If volume CRATERED, something's wrong with the
  member sign-in flow and we need to unblock.

---

## Rollback plan

If something catastrophic happens on cutover day (mass sign-in
failures, booking flow broken, etc.) you can:

1. **Re-enable Skedda + Zapier** — reverses the cutover. Members
   return to Skedda for bookings. Tell them via an "emergency" email
   broadcast that we'll try the cutover again next week.
2. **Leave our system running for those already on it.** The
   double-booking detection we built 2026-04-22 catches any overlaps
   during the rollback window — you'll know within minutes if anyone
   books over someone else.

Most cutovers go clean. Plan for the unclean scenario anyway.

---

## Tools the operator has

- `/app` — install explainer (Add to Home Screen walkthrough)
- `/book` — public booking (also shows tier cards + availability)
- `/members` — sign-in page (most direct URL for emails)
- `/join/<slug>` — per-tier signup + Stripe Checkout shortcut
- **Config → Launch Announcement** — broadcast original launch email
- **Config → Cutover Broadcasts** (new) — broadcast the three cutover
  emails with a date picker
- **Config → Today** — conflict banner + timeline + list for real-time
  ops
- **Customers tab** — "On App" KPI + per-member chip so you see who
  still needs a nudge

---

## Metrics to report at T+7

After the first full week post-cutover:

| Metric | Target |
|---|---|
| Paying members logged in | ≥ 95% (68+/72) |
| Double-bookings detected | 0 |
| Booking volume vs baseline | ≥ 90% of prior-week same-day |
| Support emails from confused members | < 10 total over the week |

If all four hit, delete the legacy `pages/api/booking-webhook.js` and
the `WEBHOOK_SECRET` env var. Clean repo, single source of truth.
