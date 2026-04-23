-- Track detected double-bookings across the Skedda/new-portal boundary.
--
-- Context: during the transition from Skedda (old) to the new booking
-- portal, the two systems don't share availability. Member A books
-- 6pm Bay 1 via the new portal; Member B books the same slot via
-- Skedda (Skedda doesn't know about A); Zapier relays B's booking to
-- our webhook where it lands as a conflict. The new-portal write path
-- (customer-book.js) already rejects overlaps because it's the single
-- source of truth for new-portal users. The Skedda-webhook path CAN'T
-- reject — the member already committed on Skedda's side — so instead
-- we stamp both rows, email the admin, and surface it clearly in the
-- dashboard so the operator can resolve it by phone.
--
-- Columns:
--   conflict_with           comma-separated list of booking_id strings
--                           overlapping this row (text, not array, so
--                           the webhook PATCH stays simple)
--   conflict_detected_at    timestamp when we noticed; used by the
--                           admin "show conflicts" query

alter table public.bookings
  add column if not exists conflict_with text,
  add column if not exists conflict_detected_at timestamptz;

create index if not exists idx_bookings_tenant_conflict
  on public.bookings (tenant_id, conflict_detected_at)
  where conflict_detected_at is not null;
