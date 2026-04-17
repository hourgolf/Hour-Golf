-- Rollback for 20260417100000_multitenant_phase2c.sql
--
-- Restores DEFAULTs on tenant_id columns and disables RLS on tenant-scoped
-- tables. Only run if Phase 2C needs to be reverted.

begin;

-- ============================================================================
-- 1. Disable RLS on all tenant-scoped tables
-- ============================================================================

drop policy if exists tenant_isolation on public.members;
alter table public.members disable row level security;

drop policy if exists tenant_isolation on public.bookings;
alter table public.bookings disable row level security;

drop policy if exists tenant_isolation on public.tier_config;
alter table public.tier_config disable row level security;

drop policy if exists tenant_isolation on public.payments;
alter table public.payments disable row level security;

drop policy if exists tenant_isolation on public.admins;
alter table public.admins disable row level security;

drop policy if exists tenant_isolation on public.access_code_jobs;
alter table public.access_code_jobs disable row level security;

drop policy if exists tenant_isolation on public.email_config;
alter table public.email_config disable row level security;

drop policy if exists tenant_isolation on public.email_logs;
alter table public.email_logs disable row level security;

drop policy if exists tenant_isolation on public.member_preferences;
alter table public.member_preferences disable row level security;

drop policy if exists tenant_isolation on public.events;
alter table public.events disable row level security;

drop policy if exists tenant_isolation on public.event_interests;
alter table public.event_interests disable row level security;

drop policy if exists tenant_isolation on public.event_registrations;
alter table public.event_registrations disable row level security;

drop policy if exists tenant_isolation on public.event_popup_dismissals;
alter table public.event_popup_dismissals disable row level security;

drop policy if exists tenant_isolation on public.event_comments;
alter table public.event_comments disable row level security;

drop policy if exists tenant_isolation on public.shop_items;
alter table public.shop_items disable row level security;

drop policy if exists tenant_isolation on public.shop_orders;
alter table public.shop_orders disable row level security;

drop policy if exists tenant_isolation on public.shop_cart;
alter table public.shop_cart disable row level security;

drop policy if exists tenant_isolation on public.shop_credits;
alter table public.shop_credits disable row level security;

drop policy if exists tenant_isolation on public.loyalty_rules;
alter table public.loyalty_rules disable row level security;

drop policy if exists tenant_isolation on public.loyalty_ledger;
alter table public.loyalty_ledger disable row level security;

-- ============================================================================
-- 2. Restore DEFAULTs on tenant_id columns
-- ============================================================================

alter table public.members              alter column tenant_id set default '11111111-1111-4111-8111-111111111111';
alter table public.tier_config          alter column tenant_id set default '11111111-1111-4111-8111-111111111111';
alter table public.payments             alter column tenant_id set default '11111111-1111-4111-8111-111111111111';
alter table public.admins               alter column tenant_id set default '11111111-1111-4111-8111-111111111111';
alter table public.access_code_jobs     alter column tenant_id set default '11111111-1111-4111-8111-111111111111';
alter table public.email_config         alter column tenant_id set default '11111111-1111-4111-8111-111111111111';
alter table public.email_logs           alter column tenant_id set default '11111111-1111-4111-8111-111111111111';
alter table public.member_preferences   alter column tenant_id set default '11111111-1111-4111-8111-111111111111';
alter table public.events               alter column tenant_id set default '11111111-1111-4111-8111-111111111111';
alter table public.event_interests      alter column tenant_id set default '11111111-1111-4111-8111-111111111111';
alter table public.event_registrations  alter column tenant_id set default '11111111-1111-4111-8111-111111111111';
alter table public.event_popup_dismissals alter column tenant_id set default '11111111-1111-4111-8111-111111111111';
alter table public.event_comments       alter column tenant_id set default '11111111-1111-4111-8111-111111111111';
alter table public.shop_items           alter column tenant_id set default '11111111-1111-4111-8111-111111111111';
alter table public.shop_orders          alter column tenant_id set default '11111111-1111-4111-8111-111111111111';
alter table public.shop_cart            alter column tenant_id set default '11111111-1111-4111-8111-111111111111';
alter table public.shop_credits         alter column tenant_id set default '11111111-1111-4111-8111-111111111111';
alter table public.loyalty_rules        alter column tenant_id set default '11111111-1111-4111-8111-111111111111';
alter table public.loyalty_ledger       alter column tenant_id set default '11111111-1111-4111-8111-111111111111';

commit;
