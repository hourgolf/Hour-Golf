-- Per-tenant email configuration. Previously the Resend FROM address,
-- admin notification recipient, and email footer were hardcoded to
-- Hour Golf values in lib/email.js — so any email sent on behalf of
-- another tenant would have had Hour Golf's name and address, and
-- Pro Shop order notifications for other tenants would land in Hour
-- Golf's inbox ("starter@hour.golf" was hardcoded as the to: address).
--
-- Three columns added to public.tenants:
--
--   email_from             Resend "from" header, e.g.
--                          "Hour Golf <noreply@hourgolf.com>". NULL →
--                          fall back to platform default "${name}
--                          <onboarding@resend.dev>".
--
--   email_notification_to  Admin email that receives Pro Shop order
--                          notifications and other
--                          admin-facing emails. NULL → skip the send
--                          instead of sending to the wrong tenant.
--
--   email_footer_text      Text appended after the em-dash in every
--                          member-facing email footer. e.g.
--                          "Hour Golf · 2526 NE 15th Ave, Portland".
--                          NULL → falls back to just tenants.name.
--
-- Hour Golf's row seeded with current hardcoded values so nothing
-- changes visually for HG members post-deploy.

alter table public.tenants
  add column if not exists email_from text,
  add column if not exists email_notification_to text,
  add column if not exists email_footer_text text;

update public.tenants
   set email_from             = 'Hour Golf <onboarding@resend.dev>',
       email_notification_to  = 'starter@hour.golf',
       email_footer_text      = 'Hour Golf · 2526 NE 15th Ave, Portland'
 where id = '11111111-1111-4111-8111-111111111111';
