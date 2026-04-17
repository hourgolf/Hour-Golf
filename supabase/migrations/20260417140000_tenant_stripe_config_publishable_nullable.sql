-- Make tenant_stripe_config.publishable_key nullable.
--
-- Phase 7A shipped the column as NOT NULL. On user verification it turned
-- out this app uses Stripe Checkout (redirect flow) exclusively, so the
-- publishable key isn't actually consumed anywhere today. Hour Golf's
-- Vercel env doesn't even have STRIPE_PUBLISHABLE_KEY set. If we add
-- Stripe Elements or other client-side Stripe.js flows later, we can
-- require it again per-tenant.

begin;

alter table public.tenant_stripe_config
  alter column publishable_key drop not null;

commit;
