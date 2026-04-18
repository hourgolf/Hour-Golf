# Ourlee — Platform Overview for Business-Model Discussion

*Snapshot written 2026-04-18. Hand this whole file to ChatGPT / Claude chat / a
co-founder conversation; it's self-contained.*

---

## What Ourlee is

Ourlee is a **multi-tenant, white-label SaaS** for member-based facilities —
originally built for Hour Golf (a Portland-area indoor golf studio) and now
being generalized into a platform that any venue like it can spin up on. The
product is the full member-facing portal + admin dashboard + automation for a
"book bays, manage members, run events, sell shop goods" business.

**A tenant** is one paying customer of Ourlee (e.g. Hour Golf). Each tenant
gets:

- Their own subdomain (`hourgolf.ourlee.co`, `swingstudio.ourlee.co`, etc.)
- Full custom branding (colors, logos, fonts, welcome copy, PWA icon)
- Their own Stripe account hooked up to collect money from *their* members
- Their own Seam (smart-lock) account for access-code generation
- Their own email sender domain (or a shared `ourlee.co` fallback)
- An isolated slice of every database table (tenant_id on every row, RLS enforced)

**A member** is a customer of a tenant (e.g. someone who booked a bay at Hour
Golf). Members never see the word "Ourlee" — they see the tenant's brand.

**Platform admin** is Matt (me) — the only role that can see all tenants, create
new ones, tweak their config, suspend/delete. Platform admin is distinct from
tenant admin both conceptually and at the auth layer (separate `platform_admins`
table, separate login flow at `ourlee.co/platform/login`).

---

## What's live in production right now

- **Hour Golf** — `hourgolf.ourlee.co`. ~80 real paying members. Live Stripe,
  live Seam lock codes, live email. The reference tenant; everything else
  generalizes from here.
- **Parts Dept** — `partsdept.ourlee.co`. Test tenant created while proving
  multi-tenancy. Zero members. Sits there to prove tenant isolation holds.

Everything below is either running in prod or wired and ready for a second
paying tenant to drop in.

---

## Tech stack

| Layer | What |
|---|---|
| App | Next.js 14 (Pages router), React 18, deployed on Vercel |
| DB + auth + storage | Supabase (single Postgres with tenant_id on every table; RLS enforces isolation) |
| Email | Resend (verified `ourlee.co` domain as fallback; per-tenant domains supported) |
| Member payments | Stripe, per-tenant accounts — each tenant has their own keys stored in `tenant_stripe_config` |
| Smart locks | Seam, per-tenant accounts — each tenant has their own keys stored in `tenant_seam_config` |
| Background jobs | Supabase Edge Functions (access code generation every 2 min, cancellation cleanup) |
| Super-admin console | `/platform` — sidebar + tabbed detail pages — Supabase-style light UI |

---

## The 9 feature flags (the billing hooks)

Every tenant has a row per feature in `tenant_features`. Toggling a feature off
hides the nav in the member portal, returns 404 from the feature's API routes,
and stops sending related emails. **These are the unit of upcharge** — the
place where "what does this tenant pay for" is cleanly defined.

| Feature key | What the tenant gets |
|---|---|
| `bookings` | Members can reserve bays through the portal. The core product — nearly every tenant will have this on. |
| `pro_shop` | A curated pro-shop tab where members buy apparel / gear with auto-inventory and drop dates. |
| `loyalty` | Monthly rules that convert member activity (hours booked, bookings, shop spend) into pro-shop credit. |
| `events` | A tournament / demo / lesson event system with RSVP, interest signals, and Stripe-paid tickets. |
| `punch_passes` | Discounted bulk-hour packages sold via Stripe Checkout. |
| `subscriptions` | Tier-based monthly billing — the "Patron / Player / Unlimited" membership system. |
| `stripe_enabled` | Master kill switch for every Stripe flow (overrides the individual feature flags). |
| `email_notifications` | All transactional emails (booking confirmations, cancellations, welcome, receipts, access codes). |
| `access_codes` | Seam smart-lock integration — generates a per-booking door code and emails it 10 min before start. Requires Seam API key. |

---

## Current billing layer — TENANT → THEIR MEMBERS (built, working)

- Each tenant's member portal runs against **their** Stripe account.
- The tenant collects subscription dues, punch-pass purchases, event tickets,
  overage charges, and pro-shop orders directly into their account. Ourlee
  never touches that money.
- Every tenant gets a per-tenant Stripe webhook at
  `<slug>.ourlee.co/api/stripe-webhook/<slug>`, signed with a secret stored in
  `tenant_stripe_config`. This was just shipped in Phase 7C.
- Tenant admins see the full payment history in `Customers → Payments` in
  their dashboard.

---

## Missing billing layer — OURLEE → TENANTS (needs to be built)

This is what you're about to design the business model for. Today:

- **Nothing charges tenants.** Hour Golf pays nothing to Ourlee. A new tenant
  onboarding would produce zero revenue without a manual invoice process.
- **No pricing config exists.** There's no table that says "bookings is $X,
  pro_shop adds $Y, loyalty adds $Z."
- **No Ourlee-level Stripe account is wired in.** The only Stripe credentials
  in the codebase are the per-tenant ones.
- **No invoices, no payment status, no dunning.** A tenant can sit on the
  platform for a year without anyone asking them for money.
- **Feature toggles have no cost implication in the UI.** Matt can flip a
  feature on or off from `/platform/tenants/<slug> → Features` with no
  indication of what that means for the tenant's bill.

This is the surface that's being built out alongside this conversation — see
the Platform UI → Billing tab and `/platform/pricing` route.

---

## Key platform operational surfaces (already built)

- `/platform` — tenant list with status, member count, features-on / features-total, Stripe mode
- `/platform/tenants/new` — create tenant flow (name, slug, optional admin email)
- `/platform/tenants/<slug>` — tabbed detail: Overview (stats, admins, tier breakdown, status toggle, danger-zone delete), Branding (colors/logos/fonts/icons/copy), Stripe (mode, kill switch, secret/publishable/webhook), Seam (API key, device id), Features (toggle matrix)
- `/platform/settings` — per-platform-admin UI prefs (accent color, density, sidebar width)

---

## Shape of the decisions you'll make when designing the model

Questions worth answering before picking a schema:

1. **Base tier + feature add-ons, OR per-feature à la carte?** A "$99/mo base,
   +$X for pro shop, +$Y for loyalty" model is easy to reason about. Pure à
   la carte ("enable only what you use") risks a lot of tiny-invoice tenants.
2. **Usage-based or flat?** Flat per-feature is simplest. But bookings could
   reasonably scale with member count or booking volume (e.g., free under 50
   members, $X/mo per additional 50 members).
3. **Is there a free tier / trial?** Hour Golf is effectively grandfathered
   at $0 today. Does it convert to paying when the model goes live, or stay
   free as the proving-ground tenant?
4. **Setup fees?** A new tenant getting white-glove Stripe + Seam + domain
   help could justify a one-time setup fee distinct from the monthly.
5. **What triggers a tenant's first invoice?** First real member signup?
   First paid Stripe event from their portal? A hard day counter from tenant
   creation?
6. **Who pays for Stripe's fees on Ourlee's billing?** Ourlee will pay
   Stripe processing fees (~2.9% + 30¢) on every tenant charge; the margin
   needs to absorb that.
7. **Currency / taxes?** Ourlee is US-only today. Adding a Canadian or EU
   tenant would require Stripe Tax or a similar solution.
8. **What happens when a tenant's card fails?** Downgrade? Suspend features
   gracefully? Hard-404 the subdomain? (This intersects with the existing
   "suspended" tenant state.)

---

## What to hand back to Claude Code after the model discussion

Once you've landed on a model, the concrete data it needs:

- **Feature pricing table:** for each of the 9 feature keys, the intended
  monthly dollars and whether it's flat or volume-based.
- **Base tier (if any):** a monthly figure that applies regardless of
  enabled features.
- **Billing anchor:** when invoices start firing for a new tenant.
- **Grace / failure policy:** what happens after a failed card.
- **Stripe account info for Ourlee itself:** the platform needs its own
  Stripe account (separate from any tenant's) to actually charge anyone.
  That's a company decision (legal entity, bank linkage).

Once those are decided, I'll wire the pricing config into `/platform/pricing`,
make the Features toggle UI show dollar implications, and build the Stripe
Customer-per-tenant + Subscription subscribe/unsubscribe flow.

---

*Ping back with the model and I'll run it end-to-end.*
