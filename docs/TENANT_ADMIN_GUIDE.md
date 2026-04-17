# Tenant Admin Guide

Welcome to Ourlee. This doc covers everything you need to know to run
your venue on the platform.

Your admin dashboard: `https://<your-slug>.ourlee.co/admin`

---

## Contents

1. [Getting started](#1-getting-started)
2. [Branding your tenant](#2-branding-your-tenant)
3. [Managing members and tiers](#3-managing-members-and-tiers)
4. [Bookings](#4-bookings)
5. [Pro Shop](#5-pro-shop) *(if enabled)*
6. [Events](#6-events) *(if enabled)*
7. [Loyalty rewards](#7-loyalty-rewards) *(if enabled)*
8. [Payments and billing](#8-payments-and-billing)
9. [Access codes](#9-access-codes) *(if enabled)*
10. [Member communication](#10-member-communication)
11. [Getting help](#11-getting-help)

---

## 1. Getting started

### Your first login

1. Go to `https://<your-slug>.ourlee.co/admin` (your platform contact will confirm your exact slug)
2. Enter the email the platform operator invited you with
3. Enter your password (you set this during signup or via password reset)
4. Land on your admin dashboard

### Your dashboard overview

The admin dashboard has these tabs across the top:

- **Today** — Current bookings, revenue, today's members
- **Calendar** — Full bay schedule view
- **Usage** — Monthly breakdown: hours used per member, overage charges
- **Customers** — Every member, filterable by tier
- **Events** *(if enabled)* — Event pages, RSVPs
- **Shop** *(if enabled)* — Pro shop items, orders
- **Config** — Tier setup, pricing, rules
- **Reports** — Exports and analytics
- **Settings** — Your dashboard preferences + tenant brand

### Your role vs. platform operator's role

- **You (tenant admin)**: Day-to-day operations. Members, bookings, shop inventory, events, pricing. All configurable from your dashboard.
- **Platform operator**: Technical setup. Turning features on/off, configuring Stripe/Seam integrations, handling platform-level issues.

If something feels like it should be configurable but you don't see it, contact your platform operator.

---

## 2. Branding your tenant

Settings → Tenant Brand. Everything here affects every member-facing page + email on your subdomain.

### Colors (5 slots)

- **Primary**: Main brand color — buttons, headers, active states
- **Accent**: Highlights — FABs, tags, feature callouts
- **Danger**: Destructive actions (cancel, delete)
- **Background**: Page + surface color
- **Text**: Primary body text

Use a hex code (`#4C8D73`) or the color picker. Save to apply — changes propagate within a minute on member pages.

### Logos (3 slots)

- **Welcome Logo**: Big hero image on login pages (both admin and member portal). Best for a full wordmark or iconic visual.
- **Header Logo**: Compact logo for the persistent nav bar. Should read well at small size.
- **Icon**: Decorative mark in the top-left of member header. Optional.

For each logo, you can:
- Upload an image file (PNG/SVG recommended, max ~500KB)
- Or paste a URL to an existing hosted image
- Toggle **Show** off to hide that logo entirely
- Pick **S / M / L** size

The platform enforces max dimensions so logos can't break page layout. If your logo looks small at L, your source image may be lower resolution than the max — try L anyway; it just won't upscale past its native size.

Also in the Logos section:
- **Show tenant name as text on login pages** — useful if your logo is just an icon and you want the name spelled out beneath
- **Show tenant name as text in persistent header** — useful if you don't have a header logo uploaded

### Background

Optional full-page background image for your member portal. Set a mood with a course photo or texture. Recommended: ~1920×1080, under 2MB.

### Fonts

- **Display font**: Used for headings and the hero logo text (if no logo image)
- **Body font**: Used for all body copy

Pick from the curated list of Google Fonts (pre-loaded by the platform) or upload a custom `.woff2` display font file (under 2MB).

### Copy

- **Login Welcome Message**: Shown below the logo on the member portal login screen. Example: "Welcome back." or "Ready to play?"

### Support & Legal

- **Terms & Conditions URL**: Your legal terms. Linked from signup and booking consent.
- **Club Policies URL**: Your house rules. Also linked from signup and booking.
- **Support Email**: Where members can email you for help. Used in the Help drawer FAQ and member communication.
- **Support Phone**: Phone/text for support. Linked as a `tel:` link in the Help drawer.
- **Facility Hours**: Free text describing when members can access the venue. Shown in the FAQ.
- **Backup Access Code** *(if Access Codes enabled)*: Your physical lock's backup code. Shown to members if their Seam-generated code fails.

---

## 3. Managing members and tiers

### Tier config (Config tab)

Tiers are your membership levels. Each has:

- **Name** (e.g. "Starter", "Patron", "Unlimited")
- **Monthly fee** (Stripe-linked if you use subscriptions)
- **Included hours/month** (member's allotment)
- **Overage rate** ($ per hour beyond included)
- **Pro shop discount %** (if applicable)
- **Display order** (controls order on upgrade/downgrade screens)
- **Public**: Whether members can self-upgrade to this tier

Special tier: `Non-Member`. This is the default for unregistered bookers. Their rate is defined in this tier's `overage_rate` field.

Save changes — new tier configs apply instantly. Existing member subscriptions are unaffected until next billing cycle.

### Members list (Customers tab)

Every registered member appears here. Click a member to view their full profile:
- Tier, status, billing details
- Booking history
- Usage this month
- Shop orders
- Loyalty progress

Actions from the profile:
- **Change tier**: Manually upgrade/downgrade. Triggers Stripe subscription update if Stripe is configured.
- **Charge overage**: For monthly overage settlements (automated at month-end, but you can trigger manually).
- **Reset password**: Sends them a password reset email via the platform.
- **Cancel membership**: Cancel their tier subscription at end of current period.

### Non-members

People who book without registering first land in `bookings` but not `members`. From the Today/Calendar/Usage view, you can charge a non-member for their session (one-off charge) — requires them to have a saved card in Stripe.

---

## 4. Bookings

Members book from their portal; you see all bookings in real time on Today / Calendar.

### Calendar

- Switch bays with the tab selector
- Click any empty slot to add a booking (admin override — bypasses member-side validation)
- Click any existing booking to edit or cancel

### Cancelling a booking (admin path)

Click the booking → Cancel. What happens:
- `booking_status` set to "Cancelled"
- If access codes are enabled and a code was already generated, the Seam code is automatically deleted (via platform cleanup; may take up to 2 minutes)
- Cancellation email goes to the member
- Hour allocation restored for the cycle

### Overage charging

At month-end, members who exceeded their included hours accumulate overage. The Usage tab summarizes who owes what. You can:
- **Bulk charge all overages** — kicks off per-member Stripe charges using their saved cards
- **Charge a single member's overage** — if you want to settle one at a time
- **Forgive / refund** — via Stripe dashboard directly

---

## 5. Pro Shop *(if enabled)*

The Shop tab lets you curate a member-only pro shop.

### Items

Each item has:
- Title, subtitle, description
- Price (USD)
- Category, brand (optional metadata for filtering)
- Image URLs (primary + secondary gallery shots)
- Inventory: `quantity_available` + `quantity_claimed` (auto-incremented as members buy)
- Sizes: array of available sizes (e.g. `["S", "M", "L", "XL"]`)
- `is_limited`: flag for drop items
- `drop_date`: if set, item hidden from members until this date
- `is_published`: toggle to hide from members without deleting

### Orders

Each purchase is a row in `shop_orders`. From the Orders tab of Shop, you can:
- Mark orders fulfilled (when member picks up)
- Export for inventory tracking
- See per-item sales history

### Pro shop credits

Members can have a `shop_credit_balance` (earned via loyalty rewards or manually granted). Credits apply automatically at checkout before Stripe is charged.

---

## 6. Events *(if enabled)*

The Events tab lets you run venue events — tournaments, demo days, lessons.

Each event has:
- Title, description, start/end dates
- Max capacity
- Cost ($0 for free events)
- Optional cover image
- `is_published` toggle

Members can RSVP (free events) or register via Stripe Checkout (paid events). You see registrations + interest signals (members who viewed but didn't register) per event.

Members receive an automated reminder email before the event.

---

## 7. Loyalty rewards *(if enabled)*

Config → Loyalty Rules. Each rule defines an incentive:

- **Rule type**: `hours` (bay hours booked), `bookings` (session count), `shop_spend` (pro shop dollars)
- **Threshold**: How much is required
- **Reward**: How many dollars of pro shop credit they earn
- **Window**: Monthly reset (rolls over first of month)
- **Enabled**: Toggle to pause without deleting

Example: "Book 10+ hours in a month → earn $10 pro shop credit."

Credits auto-issue when thresholds are hit and appear in the member's `shop_credit_balance`.

---

## 8. Payments and billing

### Stripe integration

Your platform operator configures the Stripe connection (your secret key, webhook, etc.) at setup. You don't see these details — just the results.

Members can:
- Pay monthly tier subscriptions
- Purchase punch passes (bulk hour packages at discount)
- Check out from pro shop
- Pay for event registrations
- Settle overage charges

Everything flows to your Stripe account. Refunds happen in Stripe dashboard directly.

### Viewing payment history

Customers tab → click a member → scroll to Payments. Lists every transaction with Stripe payment_intent IDs (for cross-reference in Stripe dashboard).

### What to do if a charge fails

- Card declined: Member contacts you, updates their card in their Billing tab, retry.
- Subscription failed to auto-renew: Stripe retries automatically 3 times over ~2 weeks. After that, tier silently expires to `Non-Member`. You can nudge them.

---

## 9. Access codes *(if enabled)*

If your facility uses smart-lock door codes, here's what happens:

### Member flow
1. Member books a bay for, say, 3:00 PM
2. At 2:50 PM (10 min before start), the platform generates a unique access code via Seam and sends it to the member's email
3. Code is valid on the lock from 2:50 PM until 3:10 PM (10 min after end)
4. Member enters code at keypad → door unlocks

### Your role
- **Configure a backup access code** in Settings → Tenant Brand → Backup Access Code. Surfaced to members in the Help drawer if their generated code fails.
- **If a member reports their code doesn't work**: Check your Seam dashboard for the specific code. Usual causes: member tried before 2:50 PM (code not yet active) or after 3:10 PM (code expired). Direct them to the backup code or reset from your keypad.

### Cancelling a booking with an access code

If you cancel a booking (admin dashboard) after the code was sent, the code is automatically deleted from your lock within ~2 minutes. Member can no longer use it.

---

## 10. Member communication

Members receive automated emails at key points:
- Booking confirmation (immediate)
- Access code (10 min before booking, if enabled)
- Booking cancellation (immediate)
- Welcome email (on tier upgrade via Stripe)
- Payment receipt (after successful charge)
- Password reset (when requested)

All emails branded with your tenant name, colors (in the headers/callouts), and footer (your venue's address/contact info from Support & Legal settings).

**To change email copy beyond branding**: The platform doesn't yet offer per-email-template editing. If you need custom copy, contact your platform operator.

---

## 11. Getting help

### Self-serve

- This guide
- The Help drawer on your member portal (click the `?` icon)
- Your tenant admin dashboard surfaces useful error messages when something fails — read those

### When to contact the platform operator

- Stripe keys need rotating
- Smart lock (Seam) API key needs rotating
- You want a feature turned on/off (pro shop, loyalty, events, etc.)
- You want a new admin added to your team
- You spot a bug (something doesn't behave as described)
- Your subdomain is unreachable (platform-side issue)
- You want your tenant suspended (paused temporarily) or deleted

Contact details: [your platform operator's email/phone]

### What NOT to contact the platform operator for

- Day-to-day operations covered in this guide — those are yours to drive
- Configuring your own members, tiers, pricing, events, shop items — all self-serve
- Changing your brand colors, logos, copy — self-serve in Settings
- Cancelling or rebooking a member's slot — self-serve in Today / Calendar
