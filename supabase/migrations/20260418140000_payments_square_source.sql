-- Extend the payments table to record Square POS purchases alongside
-- existing Stripe-driven ones. We prefer one payments table over a
-- separate square_payments table so the admin customer-detail view
-- shows a single chronological ledger and the monthly loyalty
-- aggregation (admin-loyalty.js) can sum across sources without
-- changing the table it reads.
--
-- Columns added (both nullable):
--   source             Optional marker: 'stripe', 'square_pos'.
--                      Existing rows left NULL — Stripe rows are
--                      identified by presence of
--                      stripe_payment_intent_id, Square rows by
--                      source='square_pos'. Future code may
--                      backfill this for Stripe rows, but it's not
--                      required for Phase 2 to work.
--   square_payment_id  Unique Square payment identifier, used for
--                      webhook idempotency so a retried delivery
--                      can't double-credit a member.
--
-- Neither column has a default; adding them is a metadata-only
-- change and does not rewrite existing rows.

alter table public.payments
  add column if not exists source text,
  add column if not exists square_payment_id text;

-- Partial unique index: one row per (tenant, square_payment_id) when
-- Square is the source. Matches the pattern used for member square
-- linkage. Partial because legacy Stripe rows all have NULL
-- square_payment_id and would otherwise be considered unique with
-- each other.
create unique index if not exists idx_payments_tenant_square_payment
  on public.payments (tenant_id, square_payment_id)
  where square_payment_id is not null;
