-- Enrich shop_orders rows with the same detail we capture for Square
-- POS payments: a public receipt URL members can click through, the
-- human-readable receipt number, the payment source type, and card
-- brand + last 4 when applicable.
--
-- Why on shop_orders (not payments):
--   In-app shop checkouts create one shop_orders row per line item,
--   all sharing a stripe_payment_intent_id. Receipts are per-
--   PaymentIntent, so all rows for a single checkout carry the same
--   receipt_url / receipt_number — that's by design; we treat rows
--   with the same stripe_payment_intent_id as one "purchase" on the
--   Shop > Orders tab.
--
-- All columns are nullable — existing rows stay as-is and zero-cost
-- orders paid entirely with shop credits legitimately have no Stripe
-- receipt to link to.

alter table public.shop_orders
  add column if not exists receipt_url text,
  add column if not exists receipt_number text,
  add column if not exists payment_method text,
  add column if not exists card_last_4 text,
  add column if not exists card_brand text;
