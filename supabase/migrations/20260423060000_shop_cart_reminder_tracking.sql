-- Abandoned-cart reminder tracking. When the daily cron finds a cart
-- older than 48h with no reminder ever sent (or >14 days since the
-- last), it fires a branded email and stamps last_reminder_at so we
-- don't spam the member.

alter table public.shop_cart
  add column if not exists last_reminder_at timestamptz;

-- Partial index: only rows that have been reminded before. The cron's
-- "who needs a nudge?" query starts from all old carts and excludes
-- those with a recent stamp; this index keeps that exclusion cheap.
create index if not exists idx_shop_cart_last_reminder
  on public.shop_cart (tenant_id, last_reminder_at)
  where last_reminder_at is not null;
