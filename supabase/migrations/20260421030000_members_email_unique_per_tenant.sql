-- Move from global UNIQUE(email) to (tenant_id, email) on members +
-- member_preferences.
--
-- Why: the single-tenant era left a global UNIQUE(email) on members.
-- Post-multi-tenant that's wrong — a customer can legitimately be a
-- member at two different venues on this platform with the same email.
-- The global constraint silently blocked every cross-tenant signup
-- with a 500 "Failed to create account" from member-signup.js.
--
-- Symptom 2026-04-21: member had registered mlynch_mlfd@yahoo.com on a
-- test tenant first; attempting to sign up the same email on HG threw
-- a unique violation. The server-level existing-email check in
-- member-signup.js was already tenant-scoped, so only the DB-level
-- constraint was causing the blocker.
--
-- Also pulls member_preferences in lockstep: its PK + FK both keyed on
-- bare email, which depended on the global unique index on members.
-- Verified zero existing cross-tenant email collisions before running.

-- 1. Drop the FK on member_preferences that depends on members_email_key
alter table public.member_preferences drop constraint if exists member_preferences_email_fkey;

-- 2. Drop the PK on member_preferences (email alone)
alter table public.member_preferences drop constraint if exists member_preferences_pkey;

-- 3. Drop the global unique on members.email
alter table public.members drop constraint if exists members_email_key;
drop index if exists public.members_email_key;

-- 4. Drop the old non-unique (tenant_id, email) index on members
drop index if exists public.idx_members_tenant_email;

-- 5. Add the new UNIQUE index on (tenant_id, email)
create unique index members_tenant_email_unique
  on public.members (tenant_id, email);

-- 6. Restore a primary key on member_preferences keyed by (tenant_id, email)
alter table public.member_preferences
  add constraint member_preferences_pkey primary key (tenant_id, email);

-- 7. Restore the FK pointing at the new composite unique
alter table public.member_preferences
  add constraint member_preferences_tenant_email_fkey
  foreign key (tenant_id, email)
  references public.members (tenant_id, email)
  on delete cascade;
