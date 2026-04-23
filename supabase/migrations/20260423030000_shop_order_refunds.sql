-- Refund tracking for pro shop orders.
--
-- Adds the columns needed to record a Stripe refund and link it back
-- to the order. No CHECK constraint on shop_orders.status today (the
-- enum exists only in TypeScript/client code) — we just use the new
-- status value 'refunded' alongside the existing pending/confirmed/
-- ready/picked_up/cancelled set.
--
-- Columns:
--   stripe_refund_id       returned from stripe.refunds.create; lets
--                          an operator click through to the Stripe
--                          dashboard for the ledger view
--   refunded_at            when we issued the refund (server time)
--   refund_amount_cents    the refunded amount in cents. First-pass
--                          policy is full refunds only, so this equals
--                          the order total at the moment of refund.
--                          Column exists so partial refunds can land
--                          later without a second migration.
--   refund_reason          short free-text reason entered by the
--                          operator ("size didn't fit", "arrived
--                          damaged", etc.); surfaced in the refund
--                          email to the member.

alter table public.shop_orders
  add column if not exists stripe_refund_id text,
  add column if not exists refunded_at timestamptz,
  add column if not exists refund_amount_cents integer,
  add column if not exists refund_reason text;

create index if not exists idx_shop_orders_refunded
  on public.shop_orders (tenant_id, refunded_at desc)
  where refunded_at is not null;
