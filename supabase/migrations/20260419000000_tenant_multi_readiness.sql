-- Multi-tenant readiness pass (2026-04-19): close the remaining
-- hardcoded-HG gaps that block clean tenant onboarding.
--
-- Previously hardcoded across components/lib that prospective tenants
-- would have inherited verbatim:
--
--   • lib/constants.BAYS = ["Bay 1", "Bay 2"]
--   • lib/constants.TIER_COLORS = HG palette
--   • "6 hours" cancel cutoff in MemberDashboard, HelpDrawer, email
--     copy, and member-cancel.js enforcement
--   • Calendar location in booking-confirmation email = venue name
--     (no actual address)
--
-- New columns on tenant_branding:
--
--   bays                jsonb  Array of bay names. Drives the booking
--                              grid, chip group, and availability
--                              header. NULL → callers fall back to the
--                              two-bay HG default. Tenants with 4 sims
--                              just write `["Sim 1","Sim 2","Sim 3","Sim 4"]`.
--
--   bay_label_singular  text   The noun for one bookable resource —
--                              "Bay", "Court", "Sim", "Lane". Used in
--                              copy ("Book a {bay}"). NULL → "Bay".
--
--   cancel_cutoff_hours numeric How many hours before a booking starts
--                              the member can self-cancel. NULL → 6.
--                              Server (member-cancel) and clients
--                              (dashboard, help, email copy) all read
--                              this same value so policy is one place.
--
--   facility_address    text   Mailing/visit address for the venue.
--                              Used as the LOCATION on calendar invites
--                              members add via the booking-confirmation
--                              email. NULL → calendar falls back to
--                              the venue name (current behavior).
--
--   tier_colors         jsonb  Per-tier badge styling, shape:
--                              { "<TierName>": { "bg": "#hex", "text": "#hex" } }
--                              Drives the tier pill on dashboard +
--                              header. NULL → fallback to primary-bg /
--                              primary CSS vars so every tenant gets
--                              their own primary color on the badge
--                              even before customizing per tier.
--
-- HG seeded with the values that were previously hardcoded so nothing
-- visible changes for HG members the moment this migration lands.

alter table public.tenant_branding
  add column if not exists bays                jsonb,
  add column if not exists bay_label_singular  text,
  add column if not exists cancel_cutoff_hours numeric,
  add column if not exists facility_address    text,
  add column if not exists tier_colors         jsonb;

-- Constraint: cancel_cutoff_hours must be a non-negative number when
-- set. Tenants who want immediate-cancellation set 0; the rest pick a
-- positive value. NULL falls through to the per-call fallback (6).
alter table public.tenant_branding
  drop constraint if exists tenant_branding_cancel_cutoff_hours_check;
alter table public.tenant_branding
  add constraint tenant_branding_cancel_cutoff_hours_check
  check (cancel_cutoff_hours is null or cancel_cutoff_hours >= 0);

-- Seed Hour Golf with what was hardcoded.
update public.tenant_branding
   set bays                = '["Bay 1","Bay 2"]'::jsonb,
       bay_label_singular  = 'Bay',
       cancel_cutoff_hours = 6,
       tier_colors         = '{
         "Non-Member":   {"bg":"#C92F1F","text":"#EDF3E3"},
         "Patron":       {"bg":"#D1DFCB","text":"#35443B"},
         "Starter":      {"bg":"#8BB5A0","text":"#EDF3E3"},
         "Green Jacket": {"bg":"#4C8D73","text":"#EDF3E3"},
         "Unlimited":    {"bg":"#35443B","text":"#D1DFCB"}
       }'::jsonb
 where tenant_id = '11111111-1111-4111-8111-111111111111';

-- facility_address intentionally left NULL for HG until the operator
-- populates it via the admin branding editor. The booking-confirmation
-- email's calendar LOCATION falls back to the venue name when this is
-- unset, so today's behavior is preserved.
