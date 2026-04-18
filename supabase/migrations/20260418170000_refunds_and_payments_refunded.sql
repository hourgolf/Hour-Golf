-- Refund tracking for Square POS payments (and eventually Stripe).
--
-- Two changes:
--   1. payments.refunded_cents — running total of refunded dollars
--      against the original payment. Loyalty aggregation subtracts
--      this from amount_cents to compute net shop spend so members
--      don't earn loyalty credit on money that was returned. Capped
--      at amount_cents by the webhook handler (you can't refund more
--      than the original).
--
--   2. refunds table — one row per individual refund event, FK to
--      payments. Gives us idempotency against Square's at-least-once
--      webhook delivery (unique index on external_refund_id) and a
--      queryable refund history for the admin customer detail view
--      and future member-facing receipts.
--
-- Loyalty behavior: refunds that arrive AFTER the month's loyalty has
-- already been processed do NOT claw back issued credit. existingLedger
-- in admin-loyalty.js prevents re-processing. Refunds that arrive
-- BEFORE loyalty runs reduce net spend naturally. This matches how
-- most loyalty programs work in practice — generous to members.

alter table public.payments
  add column if not exists refunded_cents integer not null default 0;

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  payment_id uuid references public.payments(id) on delete set null,
  source text,
  external_refund_id text not null,
  amount_cents integer not null,
  status text,
  reason text,
  created_at timestamptz not null default now()
);

-- Idempotency: Square may redeliver the same refund.updated webhook
-- multiple times. Unique per-tenant on the external id ensures our
-- INSERT collides and the write is a no-op if we've already recorded
-- this refund.
create unique index if not exists idx_refunds_tenant_external
  on public.refunds (tenant_id, external_refund_id);

-- Useful lookups.
create index if not exists idx_refunds_payment on public.refunds (payment_id);
create index if not exists idx_refunds_tenant_created on public.refunds (tenant_id, created_at desc);

alter table public.refunds enable row level security;
-- Service-role only. Members don't need direct table access; they see
-- refund impact via payments.refunded_cents on the Orders tab.
