-- Per-tenant Seam (smart-lock) configuration. Previously the Seam API
-- key + device ID lived in process.env (SEAM_API_KEY, SEAM_DEVICE_ID)
-- on Vercel + the process-access-codes edge function, hardcoded to
-- Hour Golf's single smart lock. A second access-codes-enabled tenant
-- needs their own keys.
--
-- Mirrors tenant_stripe_config exactly: service-role-only RLS (no
-- policies; INFO-level advisor warning is expected and intentional),
-- narrow write-once secrets, plaintext storage (acceptable MVP, Vault
-- upgrade later if the surface grows).
--
-- Columns:
--   tenant_id      PK/FK to tenants, ON DELETE CASCADE so deleting a
--                  tenant cleans up their Seam config automatically.
--   api_key        Seam API key. Plain text, service-role only.
--                  Typically starts with seam_. Never logged.
--   device_id      Seam device_id identifying the specific smart lock
--                  the tenant wants to create codes on. Most tenants
--                  will have exactly one; if future tenants need
--                  multi-device, this becomes a sub-table.
--   enabled        Kill switch independent of tenant_features. Lets an
--                  admin pause code generation without deleting keys
--                  (e.g. during facility maintenance).
--   created_at,
--   updated_at     Standard timestamps.

create table if not exists public.tenant_seam_config (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  api_key text not null,
  device_id text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tenant_seam_config enable row level security;
-- Intentionally zero policies. Service-role bypasses RLS; anon and
-- authenticated roles get no access (matching tenant_stripe_config).

-- Also add a tenant-specific backup access code for the Help drawer's
-- troubleshooting flow. HG's code was previously hardcoded ("2138") in
-- components/members/HelpDrawer.js; each access-codes tenant has their
-- own physical backup code.
alter table public.tenant_branding
  add column if not exists backup_access_code text;

-- Seed Hour Golf's previous hardcoded backup code.
update public.tenant_branding
  set backup_access_code = '2138'
  where tenant_id = '11111111-1111-4111-8111-111111111111'
    and backup_access_code is null;
