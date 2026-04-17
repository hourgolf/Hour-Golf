-- Regression fix from Phase 2C.
--
-- Phase 2C dropped the DEFAULT on access_code_jobs.tenant_id. The booking
-- insert trigger `fn_create_access_code_job` was written before multi-tenant
-- and did not propagate tenant_id when it auto-creates a row in
-- access_code_jobs. Every member-initiated booking failed with:
--
--   ERROR: null value in column "tenant_id" of relation "access_code_jobs"
--          violates not-null constraint
--
-- Fix: propagate NEW.tenant_id from the bookings row into the
-- access_code_jobs insert.
--
-- Also harden both trigger functions with pinned search_path, closing
-- the function_search_path_mutable advisor warnings.

create or replace function public.fn_create_access_code_job()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  -- Only for confirmed bookings with future start times
  if NEW.booking_status is distinct from 'Cancelled'
     and NEW.booking_start > now()
  then
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

-- Harden search_path on the cancel trigger (no behavior change — it's
-- UPDATE-only, no tenant_id writes needed).
create or replace function public.fn_cancel_access_code_job()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if lower(NEW.booking_status) like '%cancel%'
     and (OLD.booking_status is null or lower(OLD.booking_status) not like '%cancel%')
  then
    update public.access_code_jobs
    set status = 'cancelled',
        processed_at = now()
    where booking_id = NEW.booking_id
      and status in ('pending', 'failed');
  end if;
  return NEW;
end;
$function$;
