-- Gate the access_code_jobs auto-insert trigger on the per-tenant
-- access_codes feature flag. Previously fn_create_access_code_job fired
-- on every confirmed booking for every tenant, creating harmless
-- orphan rows for tenants without a Seam integration. With this change,
-- tenants whose tenant_features.access_codes row is not enabled skip
-- the insert entirely — no orphans, no processor work wasted.
--
-- The cancel trigger (fn_cancel_access_code_job) is untouched: it
-- always runs on booking-status changes, and its UPDATE simply finds
-- nothing to cancel when no job was created in the first place.
-- Idempotent and safe.
--
-- Missing feature rows default to enabled=true (matches the
-- fail-open policy in lib/tenant-features.js) — conservative, ensures
-- any tenant that SHOULD have codes but whose feature row is missing
-- still gets jobs created rather than silently dropping. Explicit
-- `enabled = false` is required to disable.

create or replace function public.fn_create_access_code_job()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  access_codes_enabled boolean;
begin
  -- Only for confirmed bookings with future start times
  if NEW.booking_status is distinct from 'Cancelled'
     and NEW.booking_start > now()
  then
    -- Feature flag check. Treat missing row as enabled (fail-open).
    select coalesce(bool_and(enabled), true)
      into access_codes_enabled
      from public.tenant_features
     where tenant_id = NEW.tenant_id
       and feature_key = 'access_codes';

    if not access_codes_enabled then
      return NEW;
    end if;

    -- Only create if no active (non-cancelled) job exists for this booking
    if not exists (
      select 1 from public.access_code_jobs
      where booking_id = NEW.booking_id
        and status not in ('cancelled')
    ) then
      insert into public.access_code_jobs (
        tenant_id,
        booking_id, customer_email, customer_name, bay,
        booking_start, booking_end, code_start, code_end, status
      ) values (
        NEW.tenant_id,
        NEW.booking_id,
        NEW.customer_email,
        NEW.customer_name,
        NEW.bay,
        NEW.booking_start,
        NEW.booking_end,
        NEW.booking_start - interval '10 minutes',
        NEW.booking_end + interval '10 minutes',
        'pending'
      );
    end if;
  end if;
  return NEW;
end;
$function$;
