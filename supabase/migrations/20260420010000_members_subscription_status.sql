-- Track Stripe subscription lifecycle on the member row so admin can see
-- who's past_due without a separate Stripe API call on every page load.
-- Values mirror Stripe's sub.status: active, past_due, unpaid, canceled,
-- incomplete, incomplete_expired, trialing, paused. NULL = unknown.
alter table public.members add column if not exists subscription_status text;

-- Partial index for the admin "past_due" dashboard pull; keeps the index
-- tiny since the common state is NULL/active.
create index if not exists idx_members_tenant_sub_status
  on public.members (tenant_id, subscription_status)
  where subscription_status is not null;
