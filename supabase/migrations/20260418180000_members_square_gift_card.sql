-- Link each member to their Square digital gift card so Square Register
-- auto-applies the in-app shop_credit_balance at the POS without staff
-- intervention. The gift card id comes from Square's /v2/gift-cards
-- response; the GAN it produces is what Square scans internally to
-- identify the card at checkout (we don't need to store the GAN since
-- we always look up by id).
--
-- Column added:
--   square_gift_card_id  Square gift card identifier (starts with
--                        gftc_ or similar). Unique per tenant — a
--                        Square customer can hold multiple gift
--                        cards but we create exactly one per member
--                        so the sync logic stays simple.
--
-- Gift card creation is lazy (only when balance > 0) so members at $0
-- don't accumulate empty gift card records on the Square side. Once
-- created, the record persists even if balance returns to $0 — reloading
-- is cheaper than re-creating, and the customer-link stays intact.

alter table public.members
  add column if not exists square_gift_card_id text;

create unique index if not exists idx_members_tenant_square_gift_card
  on public.members (tenant_id, square_gift_card_id)
  where square_gift_card_id is not null;
