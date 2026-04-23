-- Track which members received each of the three cutover-phase emails
-- so the broadcast button can be clicked multiple times (onboarding new
-- members between phases, partial resends after failures) without
-- re-spamming prior recipients. Each phase has its own column — same
-- idempotency pattern as launch_email_sent_at.
--
-- Phases:
--   announcement  sent T−14: "Skedda closing on <date>, here's what to do"
--   reminder      sent T−3:  "3 days left, you still haven't logged in"
--                            (filtered to first_app_login_at IS NULL only)
--   complete      sent T=0:  "Skedda is now closed, everything's in the app"

alter table public.members
  add column if not exists cutover_announcement_sent_at timestamptz,
  add column if not exists cutover_reminder_sent_at timestamptz,
  add column if not exists cutover_complete_sent_at timestamptz;
