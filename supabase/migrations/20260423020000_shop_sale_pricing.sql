-- Sale / markdown pricing for the pro shop.
--
-- Today `shop_items.price` is the single number a customer pays.
-- This migration adds the two columns an e-commerce platform uses to
-- model a sale:
--
--   compare_at_price    the "was" / regular price, shown with a
--                       strikethrough when greater than `price`
--   sale_ends_at        optional auto-expiry; when NULL, the sale
--                       continues until the operator manually removes
--                       compare_at_price. When set, render code checks
--                       (sale_ends_at IS NULL OR sale_ends_at > now())
--                       before showing the slashed price + SALE chip.
--
-- Nullable + no default so every existing row stays "not on sale" until
-- an operator explicitly marks it. Additive — no member-facing change
-- until compare_at_price is populated per-item.

alter table public.shop_items
  add column if not exists compare_at_price numeric,
  add column if not exists sale_ends_at timestamptz;

-- Index only rows that are currently marked on sale. Keeps the sort-by-
-- on-sale query cheap even as the catalog grows.
create index if not exists idx_shop_items_on_sale
  on public.shop_items (tenant_id, sale_ends_at)
  where compare_at_price is not null;
