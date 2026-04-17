-- Add a tenant-configurable welcome/greeting string used on the member
-- portal login screen. Previously hardcoded to "Hello Friend." (Hour
-- Golf copy). Nullable: when null, the UI falls back to a neutral
-- default ("Welcome.") so the portal still reads cleanly.

alter table public.tenant_branding
  add column if not exists welcome_message text;
