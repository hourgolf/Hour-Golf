-- Split the single `logo_url` into three distinct slots + visibility
-- toggles so tenants can control what shows where on their portal.
--
-- Previously, tenant_branding.logo_url was rendered in three contexts:
--   - Admin + member login page (hero)
--   - Member portal persistent header (compact)
--   - Admin dashboard header (compact)
-- All three received the same image. Tenants couldn't, for example,
-- show a bold clubhouse hero on login but a subtle wordmark in the
-- nav bar.
--
-- New shape:
--   welcome_logo_url   — big hero on login pages
--   header_logo_url    — compact wordmark in persistent nav
--   icon_url           — decorative mark (second-order brand element)
--   show_welcome_logo  — toggle welcome-logo visibility
--   show_welcome_title — toggle app-name text on login
--   show_header_logo   — toggle header-logo visibility
--   show_header_title  — toggle app-name text in nav
--   show_icon          — toggle decorative mark in header
--
-- Backfill: anywhere logo_url is set, copy it into both welcome_logo_url
-- and header_logo_url so the tenant's current brand keeps rendering
-- identically until they customize.
--
-- Keep legacy column logo_url in place — it's still referenced by some
-- UI code during the rollout window and provides a rollback path.

alter table public.tenant_branding
  add column if not exists welcome_logo_url text,
  add column if not exists header_logo_url text,
  add column if not exists icon_url text,
  add column if not exists show_welcome_logo boolean not null default true,
  add column if not exists show_welcome_title boolean not null default true,
  add column if not exists show_header_logo boolean not null default true,
  add column if not exists show_header_title boolean not null default false,
  add column if not exists show_icon boolean not null default false;

-- Backfill from existing logo_url so tenants don't lose their brand.
update public.tenant_branding
   set welcome_logo_url = coalesce(welcome_logo_url, logo_url),
       header_logo_url  = coalesce(header_logo_url, logo_url)
 where logo_url is not null;
