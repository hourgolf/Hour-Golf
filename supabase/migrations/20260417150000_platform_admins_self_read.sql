-- Phase 5-A: let a logged-in auth.users row read its own platform_admins
-- row (if any). Mirrors the admin_self_read policy on public.admins.
--
-- Without this, the client-side usePlatformAuth hook — which queries
-- platform_admins with the user's JWT to decide whether to show the
-- super-admin surface — always sees an empty result (RLS is enabled
-- with zero policies today). Service-role reads are unaffected.
--
-- Scope is intentionally narrow: SELECT only, only own row. No writes
-- from the client; all mutations go through service-role API routes.

create policy "platform_admin_self_read"
  on public.platform_admins
  for select
  to authenticated
  using (user_id = auth.uid());
