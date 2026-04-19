-- News / announcements feature. Mirrors the event popup + member-events
-- pattern but lives in its own table so admins can post tenant-wide
-- alerts (closures, schedule changes, important updates) without
-- creating fake events.
--
-- Two tables:
--   news_items          per-tenant news entries with visibility
--                       toggles (popup, dashboard) + severity +
--                       optional time window.
--   news_dismissals     per-member popup dismissals so members don't
--                       see the same modal every time they open the
--                       app. Mirrors event_popup_dismissals exactly.
--
-- Severity drives color treatment in the UI:
--   info     — neutral, default
--   success  — green, positive news / new feature
--   warning  — gold, heads up (parking changes, soft schedule shift)
--   urgent   — red, immediate attention (closure, emergency)

create table if not exists public.news_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null,
  body text not null,
  image_url text,
  severity text not null default 'info'
    check (severity in ('info', 'success', 'warning', 'urgent')),
  show_as_popup boolean not null default false,
  show_on_dashboard boolean not null default true,
  is_published boolean not null default true,
  display_order integer not null default 0,
  -- Time window: null = no bound. Server filters out items where
  -- now() < starts_at or now() > ends_at, so admins can schedule
  -- announcements ahead and let them auto-expire.
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.news_items_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists news_items_set_updated_at on public.news_items;
create trigger news_items_set_updated_at
  before update on public.news_items
  for each row execute function public.news_items_set_updated_at();

create index if not exists idx_news_items_tenant_active
  on public.news_items (tenant_id, is_published, display_order)
  where is_published = true;

alter table public.news_items enable row level security;

create table if not exists public.news_dismissals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  news_id uuid not null references public.news_items(id) on delete cascade,
  member_email text not null,
  dismissed_at timestamptz not null default now()
);

create unique index if not exists idx_news_dismissals_unique
  on public.news_dismissals (tenant_id, news_id, member_email);

alter table public.news_dismissals enable row level security;
