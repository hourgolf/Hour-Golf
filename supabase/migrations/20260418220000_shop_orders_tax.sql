-- Stripe Tax: per-order tax amount + Stripe Tax transaction id for
-- audit. Both nullable so existing rows + tax-exempt orders (Oregon
-- pickup, etc.) stay untouched.
--
-- tax_amount captures the dollar amount of sales tax collected on the
-- order. Webhook (guest_shop) reads it from the Checkout Session's
-- total_details.amount_tax. In-app member orders read it from the
-- Stripe Tax Calculation API call we make pre-PaymentIntent.
--
-- stripe_tax_transaction_id ties our row to the Stripe Tax
-- Transaction record so the merchant's Stripe Tax reports reconcile
-- against our DB. Created via tax.transactions.createFromCalculation
-- after the PaymentIntent succeeds. For guest_shop checkouts, Stripe
-- creates the transaction automatically when automatic_tax is on, so
-- we record the id from the session for our own audit.

alter table public.shop_orders
  add column if not exists tax_amount numeric(10, 2),
  add column if not exists stripe_tax_transaction_id text;
