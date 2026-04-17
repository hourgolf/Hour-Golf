-- Extend fn_cancel_access_code_job to handle already-sent jobs.
--
-- Previously, when a booking was cancelled:
--   - pending / failed access_code_jobs → set to 'cancelled' (correct)
--   - sent access_code_jobs → untouched, Seam code stays active
--
-- The member-portal cancel path (pages/api/member-cancel.js) deletes
-- the Seam code manually for sent jobs, but the admin-dashboard cancel
-- path uses a direct Supabase PATCH (pages/index.js:supaPatch) that
-- bypasses member-cancel entirely. Result: admin-cancelled bookings
-- leave active Seam codes until they auto-expire at code_end, which
-- is 10 min after the original booking_end. A member could still use
-- their door code during the originally-booked time slot even though
-- the booking is cancelled.
--
-- Fix: mark sent jobs with a new status 'pending_delete' when the
-- booking is cancelled. The process-access-codes edge function picks
-- these up on its next tick, calls Seam.delete_access_code, and
-- transitions the row to 'deleted'. Handles all cancel paths (admin
-- dashboard direct PATCH, member-portal, future API routes).

create or replace function public.fn_cancel_access_code_job()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if lower(NEW.booking_status) like '%cancel%'
     and (OLD.booking_status is null or lower(OLD.booking_status) not like '%cancel%')
  then
    -- Still-unsent jobs: cancel outright, no external cleanup needed.
    update public.access_code_jobs
    set status = 'cancelled',
        processed_at = now()
    where booking_id = NEW.booking_id
      and status in ('pending', 'failed');

    -- Already-sent jobs: mark for Seam deletion pass. Edge function
    -- will pick these up on its next tick and call
    -- Seam.delete_access_code. Do NOT stamp processed_at here — let
    -- the edge function set it when the Seam deletion completes, so
    -- we can distinguish "needs deletion" from "deletion completed".
    update public.access_code_jobs
    set status = 'pending_delete'
    where booking_id = NEW.booking_id
      and status = 'sent';
  end if;
  return NEW;
end;
$function$;
