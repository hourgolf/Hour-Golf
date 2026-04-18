-- Enrich payments rows with the detail Square's payment.updated webhook
-- already carries: a public receipt URL members can click through for
-- the full line-item breakdown, the human-readable receipt number, the
-- payment source type, and card brand + last 4 when it was a card
-- transaction.
--
-- All columns are nullable because:
--   - Existing rows (Stripe-sourced) predate any of these and stay NULL.
--   - Square payments in non-card flows (CASH, EXTERNAL, etc.) won't
--     populate card_* fields.
--
-- These are all printed/public fields on Square's hosted receipt
-- already; no secrets. We store them so the member dashboard can render
-- the receipt link without a Square API round-trip per page load.

alter table public.payments
  add column if not exists receipt_url text,
  add column if not exists receipt_number text,
  add column if not exists payment_method text,
  add column if not exists card_last_4 text,
  add column if not exists card_brand text;
