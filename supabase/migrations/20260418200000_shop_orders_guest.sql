-- Shop orders: support guest (unauthenticated) checkouts placed via the
-- public /shop route. Existing in-app member checkouts are unchanged —
-- the new fields default to harmless values for them.
--
-- Guest flow:
--   - Cart lives in the browser; on submit the public-shop API creates
--     a Stripe Checkout Session and inserts pending shop_orders rows
--     stamped with the session id + is_guest=true + buyer's email/phone.
--   - When the Stripe webhook fires checkout.session.completed with
--     metadata.type='guest_shop', the handler updates the matching
--     pending rows to 'confirmed' and emails a receipt.
--
-- Columns:
--   is_guest                       Boolean marker so admin views can
--                                  flag guest orders distinctly from
--                                  member orders. Defaults false.
--   stripe_checkout_session_id     Hosted Checkout Session id; lookup
--                                  key for the webhook to flip pending
--                                  -> confirmed. Distinct from
--                                  stripe_payment_intent_id which is
--                                  used by the in-app checkout flow
--                                  (off-session PaymentIntent path).
--   guest_phone                    Optional contact number captured at
--                                  guest checkout for shipping
--                                  notifications later (Phase 2).

alter table public.shop_orders
  add column if not exists is_guest boolean not null default false,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists guest_phone text;

create index if not exists idx_shop_orders_tenant_session
  on public.shop_orders (tenant_id, stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;
