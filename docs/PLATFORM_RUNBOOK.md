# Ourlee Platform Operator Runbook

Practical reference for running the platform. Assumes you (Matt) as the
sole super-admin. Written so you can re-derive how your own system
works after a gap of weeks.

Last updated: 2026-04-17.

Tenant UUID conventions used throughout:
- Hour Golf: `11111111-1111-4111-8111-111111111111`

---

## Contents

1. [Quick reference — what lives where](#1-quick-reference--what-lives-where)
2. [Onboarding a new tenant](#2-onboarding-a-new-tenant)
3. [Rotating credentials](#3-rotating-credentials)
4. [Suspending and deleting tenants](#4-suspending-and-deleting-tenants)
5. [Diagnosis playbook](#5-diagnosis-playbook)
6. [What every platform CRUD action actually does](#6-what-every-platform-crud-action-actually-does)
7. [Known risks and tripwires](#7-known-risks-and-tripwires)
8. [Emergency rollback procedures](#8-emergency-rollback-procedures)

---

## 1. Quick reference — what lives where

### Production surfaces

| Surface | URL | Who sees it |
|---|---|---|
| Platform super-admin | `/platform` on any subdomain (uses its own auth layer) | You (matt@multifresh.com seeded as platform_admin) |
| Tenant admin dashboard | `<slug>.ourlee.co/admin` | Each tenant's admins |
| Member portal | `<slug>.ourlee.co/members` | Each tenant's members |
| Hour Golf members | `hourgolf.ourlee.co/members` | ~80 current HG members |
| Legacy HG URL | `hourgolf.vercel.app` | Redirect safety net, still works via middleware fallback |

### Code + config locations

| Concern | Where |
|---|---|
| Next.js app | Vercel (auto-deploys on push to main) |
| Database + auth + storage | Supabase project `uxpkqbioxoezjmcoylkw` |
| Edge functions | Supabase: `process-access-codes`, `booking-ingest`, `booking-webhook`, `cancellation-ingest`, `auto-charge-nonmembers` |
| DNS | Vercel (nameservers delegated from GoDaddy) |
| Email | Resend (`ourlee.co` verified domain) |
| Payments | Stripe — per-tenant keys in `tenant_stripe_config` table |
| Smart locks | Seam — per-tenant keys in `tenant_seam_config` table |

### Tenant-scoped DB tables (quick mental map)

Every data table below has `tenant_id`. Never query without filtering by it.

- **Tenant core**: `tenants`, `tenant_branding`, `tenant_features`, `tenant_stripe_config`, `tenant_seam_config`
- **Identity**: `admins`, `members`, `member_preferences`
- **Platform**: `platform_admins`, `platform_admin_sessions`
- **Bookings**: `bookings`, `tier_config`, `access_code_jobs`, `payments`
- **Events**: `events`, `event_registrations`, `event_interests`, `event_comments`, `event_popup_dismissals`
- **Shop**: `shop_items`, `shop_orders`, `shop_cart`, `shop_credits`
- **Loyalty**: `loyalty_rules`, `loyalty_ledger`
- **Email**: `email_config` (Resend template IDs per tenant), `email_logs` (unused today)
- **Logs**: `webhook_debug_log`, `access_code_jobs`
- **Per-user prefs (not tenant scoped — by design)**: `app_settings`

### Feature flags

All 9 flags live in `tenant_features`:
`bookings`, `pro_shop`, `loyalty`, `events`, `punch_passes`, `subscriptions`, `stripe_enabled`, `email_notifications`, `access_codes`.

Toggle from `/platform/tenants/<slug> → Features`. UI gates + API `assertFeature` guards honor them. New tenants default all features on except `access_codes` (which defaults off — requires smart-lock hardware).

---

## 2. Onboarding a new tenant

### Prerequisites (collect from the tenant before starting)

- [ ] Tenant's legal name (e.g. "Swing Studio Venue")
- [ ] Desired subdomain slug (lowercase alphanumeric + hyphens, e.g. `swingstudio`)
- [ ] Primary admin's email (must already have a Supabase Auth account, OR plan to create one)
- [ ] Whether they want access codes (Yes → need Seam API key + device_id)
- [ ] Whether they want their own email domain (Yes → need to verify in Resend)
- [ ] Whether they have their own Stripe account (Yes → need Stripe API keys)
- [ ] Branding assets: logo file(s), colors, fonts preference

### Step-by-step

**Step 1 — Create the tenant**

1. Go to `/platform/tenants/new`
2. Fill in tenant name, slug, optional initial admin email
3. Click "Create tenant"
4. You land on `/platform/tenants/<slug>` with an empty shell

What this creates in the DB:
- `tenants` row (status=active)
- `tenant_branding` row with Hour Golf-colored defaults and Inter/DM Sans fallback fonts
- 8 `tenant_features` rows (all enabled by default, except `access_codes`)
- `admins` row linked to the initial admin's auth.users (only if their email matched an existing user)

**Step 2 — Verify DNS (once per platform, already done for ourlee.co)**

The wildcard `*.ourlee.co` on Vercel already routes to this app. New tenants just work at `<slug>.ourlee.co` immediately. No DNS action needed unless the tenant wants a custom domain (Phase 8 — not built yet).

**Step 3 — Configure branding**

1. `/platform/tenants/<slug> → Branding`
2. Colors: start with defaults, tweak per tenant design
3. Logos: upload welcome logo (hero, for login pages), header logo (compact, for nav), icon (decorative)
4. For each logo, pick S/M/L size and toggle show/hide
5. Welcome message (goes under logo on login — e.g. "Welcome back.")
6. Support & Legal section — fill in support email, phone, legal URL, terms URL, facility hours
7. Save

**Step 4 — Stripe setup (only if tenant takes payments)**

1. Tenant admin creates a Stripe account (or you can help via Stripe's account creation API — not yet automated)
2. Get from tenant: `sk_live_...`, `pk_live_...` (optional), `whsec_...` (after they set up the webhook in Stripe dashboard)
3. In Stripe Dashboard, under Developers → Webhooks → Add endpoint: URL is `https://<slug>.ourlee.co/api/stripe-webhook` (note: this route is still single-tenant-shaped — Phase 7C not fully done for multi-tenant webhook isolation; for now all tenants share the same webhook endpoint. When a second tenant goes live with real Stripe, this needs the per-tenant webhook URL migration first.)
4. `/platform/tenants/<slug> → Stripe` tab
5. Paste secret key, publishable key (optional), webhook secret
6. Set mode (test or live), set enabled=true
7. Save

Risks to explain to the tenant:
- **Failed Stripe charges** show up as `status=failed` in `payments` table. Admin dashboard → Customers → Payments History shows these.
- **Webhook signature failures** mean Stripe events aren't syncing. Symptoms: subscription upgrades don't reflect in members table. Check `webhook_debug_log`.

**Step 5 — Seam setup (only if tenant wants access codes)**

1. Tenant admin sets up their Seam.co account and registers their smart lock(s)
2. Get from tenant: `seam_...` API key, device_id (UUID of the specific lock)
3. `/platform/tenants/<slug> → Seam` tab
4. Paste API key, device_id
5. Set enabled=true, save
6. Go to `/platform/tenants/<slug> → Features` tab
7. Toggle `access_codes` → ON

That's it — the DB trigger starts creating `access_code_jobs` for new bookings. The `process-access-codes` edge function (runs every 2 min on cron) picks them up, calls Seam to create a per-booking code, and emails the member via Resend.

Also set a backup access code in Branding → Support & Legal → Backup Access Code (physical code the tenant configured on the lock as a fallback).

**Step 6 — Feature flags**

`/platform/tenants/<slug> → Features`. Toggle off anything the tenant isn't paying for / doesn't use:
- No pro shop? Turn off `pro_shop`.
- No loyalty program? Turn off `loyalty`.
- No events? Turn off `events`.
- No punch pass purchases? Turn off `punch_passes`.
- No tier-based subscriptions? Turn off `subscriptions`.

Turning off cleanly hides the nav items + returns 404 on feature-specific API routes.

**Step 7 — Initial admin invite**

If the admin's email didn't auto-link during Step 1 (they didn't already have a Supabase Auth account), two options:

- **Option A (recommended):** Ask them to sign up themselves at `<slug>.ourlee.co/admin` using Supabase Auth's email+password. Once they have an auth.users row, you insert them into `admins`:
  ```sql
  insert into public.admins (user_id, email, tenant_id, display_name)
  select id, email, '<tenant-uuid>', split_part(email, '@', 1)
    from auth.users where email = 'their@email.com';
  ```

- **Option B:** Use the Supabase Dashboard → Authentication → Users → Invite user. Send them a magic link. Then add them to `admins` as above.

**Step 8 — Smoke test**

As the new tenant admin:
1. Log into `<slug>.ourlee.co/admin` — should see their dashboard with their branding
2. Go to Settings → Tenant Brand — verify colors, logo, support info
3. Create a test tier (e.g. "Test Tier", $1/month, 1 hour included)
4. Manually create a test member (or have someone sign up via the member portal)
5. As that member, book a bay
6. Verify the booking confirmation email arrives with tenant branding
7. If access codes are enabled, verify the access code email arrives at code_start (booking start − 10 min)
8. Cancel the booking → verify cancellation email + (if code was sent) Seam code deletion

---

## 3. Rotating credentials

### Stripe keys

1. Generate new Stripe key in Stripe Dashboard
2. `/platform/tenants/<slug> → Stripe` tab
3. Paste new `sk_...` into secret key field, save
4. The in-memory cache in `lib/stripe-config.js` invalidates immediately — next payment attempt uses new key
5. Revoke old key in Stripe Dashboard once you've confirmed the new one works (e.g. by triggering one payment)

### Seam API key

1. Generate new Seam key
2. `/platform/tenants/<slug> → Seam` tab
3. Paste new `seam_...` key, save
4. Cache invalidated, next access-code job uses the new key
5. Revoke old key in Seam dashboard

### Resend API key (platform-wide, not per tenant)

1. Generate new Resend key
2. Update Vercel env `RESEND_API_KEY` (all environments) → requires redeploy
3. Update Supabase Edge Function secret `RESEND_API_KEY` in Project Settings → Edge Functions → Secrets
4. Redeploy the `process-access-codes` edge function so it picks up the new secret
5. Revoke old key

### Supabase service role key

This one is nuclear — DO NOT rotate casually. If you must:

1. Supabase Dashboard → Project Settings → API → "Reset service_role key"
2. Update Vercel env `SUPABASE_SERVICE_ROLE_KEY` (immediate redeploy on push)
3. Update Supabase Edge Function secret `SUPABASE_SERVICE_ROLE_KEY`
4. Redeploy `process-access-codes` and any other edge function
5. Update any other integrations that use the service role key

All API routes and edge functions will fail simultaneously until both Vercel + Edge secrets are updated. Do during low-traffic window.

### Platform admin password

Each platform admin's password is stored in auth.users (hashed by Supabase). Reset via Supabase Dashboard → Authentication → Users → find your user → Reset password. Or sign in and use the member-facing password reset flow (works identically for auth.users).

---

## 4. Suspending and deleting tenants

### Suspend (reversible)

From `/platform/tenants/<slug> → Overview → Status → Suspend tenant`.

What it does:
- Sets `tenants.status = 'suspended'`
- Tenant subdomain returns 404 for users (when `MULTI_TENANT_STRICT=true`, which it is in prod)
- All data remains intact
- Data still appears in `/platform` but no member-facing surface works

To reactivate: same button → Reactivate.

### Hard delete (permanent)

Only allowed for suspended tenants with NO data. From the same Overview tab after suspending:

1. Click "Delete tenant permanently"
2. Type `DELETE <slug>` to confirm
3. If any referencing table has rows, you'll get a 409 with counts. Options:
   - **Suspend-only path:** Keep tenant in suspended status indefinitely. Simplest and safest.
   - **Manual cleanup path:** Use Supabase SQL editor to delete rows from each flagged table. Typical order: `access_code_jobs` → `event_registrations` → `event_interests` → `event_comments` → `event_popup_dismissals` → `events` → `shop_orders` → `shop_cart` → `shop_credits` → `shop_items` → `loyalty_ledger` → `loyalty_rules` → `member_preferences` → `members` → `payments` → `bookings` → `tier_config` → `email_logs` → `email_config` → `admins`. Then retry delete.

After successful delete:
- `tenants` row dropped
- `tenant_branding`, `tenant_features`, `tenant_stripe_config`, `tenant_seam_config` cascade-drop automatically
- Subdomain stops resolving

There is no undo. Use suspend unless you're sure.

---

## 5. Diagnosis playbook

Common symptoms and their first-look checks.

### "Member can't log in to their portal"

1. Member's email in the correct tenant? Check `/platform/tenants/<slug>` member count. If zero, they may have signed up on a different tenant or never finished signup.
2. Query: `select email, tenant_id, session_token is not null as has_session, session_expires_at from members where email = '...';`
3. If `has_session=false` or `session_expires_at` is in the past — they need to log in fresh (session expired or logged out elsewhere). Member sessions are currently single-token-per-member (Tier 2 deferred fix); logging in on device B invalidates device A.
4. If RLS blocks their login — run the same query with service role. If you see data but the member's session check fails via their anon/member JWT, suspect `tenant_isolation` RLS policy.

### "Booking confirmation email didn't arrive"

1. Check Resend Dashboard → Emails for that recipient + timestamp
2. If no entry: email was never sent. Check Vercel function logs for the relevant API route (`customer-book`, `member-cancel`, etc.).
3. If entry shows 200: email was accepted by Resend. Check spam folder.
4. If entry shows 403 "testing domain restriction": the `from` address is still `onboarding@resend.dev`. Update `tenants.email_from` for that tenant to use a verified domain (`@ourlee.co` or the tenant's own verified domain).
5. If entry shows other 4xx: inspect the `from` address validity — needs to match a verified Resend domain.

### "Access code didn't arrive"

Check the job row:
```sql
select booking_id, status, to_char(code_start, 'HH24:MI:SS') as code_start,
       to_char(processed_at, 'HH24:MI:SS') as processed, error_message
  from access_code_jobs
 where booking_id = '...';
```

Possible states:
- `pending` — waiting for code_start to arrive. Edge function picks up once `now() >= code_start`. If stuck pending 10+ min past code_start, edge function may be broken.
- `processing` — locked for processing. Usually transient; if stuck, something failed mid-loop.
- `sent` — code was created and email sent. Member should have it. If they don't: spam folder, Resend log check.
- `failed` — transient error, will retry on next cron. Check `error_message`.
- `failed_permanent` — retry cap hit. Inspect `error_message`. Usually Seam API 401 (bad key) or missing config. Check `tenant_seam_config` for the tenant.
- `cancelled` — booking was cancelled before code could be sent. Expected.
- `pending_delete` — booking was cancelled after code was sent, awaiting Seam.delete_access_code call.
- `deleted` — Seam code successfully removed.

### "Stripe charge failed"

```sql
select stripe_payment_intent_id, amount_cents, status, description, created_at, member_email
  from payments
 where member_email = '...'
 order by created_at desc limit 10;
```

Statuses: `succeeded`, `refunded`, `failed`. Look for `failed`, then cross-reference the `stripe_payment_intent_id` in Stripe Dashboard → Payments to see the decline reason.

Common reasons: card declined (retry), card expired (member updates billing), `tenant_stripe_config.enabled=false` (platform-side — flip on).

### "Subdomain returns 404"

1. `select status from tenants where slug = '<slug>';` — if `suspended`, that's why. Reactivate.
2. If `status=active` but still 404s — check Vercel → your project → Domains. `<slug>.ourlee.co` should resolve via the `*.ourlee.co` wildcard. If DNS is broken, the wildcard may be misconfigured.
3. Middleware tenant cache could be serving a negative cache entry (10-second TTL). Wait 15 seconds and retry. If still failing, Vercel instance might be cold — hit any page once to warm it.

### "Feature toggle isn't taking effect"

Changes go through `/api/platform-tenant-features` which invalidates cache. But `_document.js` loads features once per page render, and the client reads from `window.__TENANT_FEATURES__` set at SSR time. For members already mid-session: they need to hard refresh. For server-side: next request in that Vercel instance uses updated values within 60s (cache TTL).

If still not working, check:
```sql
select feature_key, enabled from tenant_features
 where tenant_id = '<uuid>' order by feature_key;
```
Confirm the row reflects your toggle.

### "RLS seems to be blocking me"

Service-role bypasses RLS. Anon and authenticated roles go through policies. If you're querying as anon/auth from the Supabase SQL editor, you're hitting RLS.

To diagnose: re-run the query as service_role (click the role dropdown in SQL editor). If it returns data, the RLS policy is the culprit. Known RLS surfaces:
- All tenant-scoped tables have `tenant_isolation` policy requiring `current_setting('app.tenant_id')` to match — that setting isn't set in the SQL editor, so you'll always see empty rows under anon/auth.
- `admin_all` policies check membership in `admins` via `auth.uid()`. Works for an authenticated admin JWT; anon gets nothing.

---

## 6. What every platform CRUD action actually does

For auditing, rollback, and understanding side effects.

### POST `/api/platform-tenant-create`
1. INSERT into `tenants` (id auto, slug + name, status=active)
2. INSERT into `tenant_branding` (with DEFAULT_BRANDING constants)
3. INSERT 8 rows into `tenant_features` (all enabled by default)
4. Optionally INSERT into `admins` (only if initial admin email matched existing auth.users)
5. On any later-stage failure: best-effort reverse cleanup via DELETEs

### PATCH `/api/platform-tenant-status`
1. UPDATE `tenants.status` to 'active' or 'suspended'
2. Subdomain 404s when `MULTI_TENANT_STRICT=true` and tenant is suspended
3. No data touched

### DELETE `/api/platform-tenant-delete`
1. Pre-flight count across 20 tenant_id data tables
2. If any non-zero: return 409 with counts, do nothing
3. If all zero: DELETE from `tenants`
4. FK CASCADE removes `tenant_branding`, `tenant_features`, `tenant_stripe_config`, `tenant_seam_config`
5. No data is recoverable after this succeeds

### PATCH `/api/platform-tenant-branding`
1. Validates color (hex), URL (http/https), boolean, s/m/l size, string length per field
2. UPDATE `tenant_branding` with changed fields only
3. Calls `invalidateBranding(tenant_id)` to flush in-memory cache
4. Next SSR page render on that tenant picks up new values within 60s (cold cache refresh)

### PATCH `/api/platform-tenant-stripe`
1. If no existing row: INSERT (requires api_key + device_id). Defaults enabled=false for safety.
2. If existing row: PATCH only the fields present in the body
3. Empty secret_key is ignored (never clears the key)
4. Calls `invalidateStripeConfig(tenant_id)`

### PATCH `/api/platform-tenant-seam`
Same shape as stripe — upsert with masked response, cache invalidation.

### PATCH `/api/platform-tenant-features`
1. UPSERT into `tenant_features` on conflict (tenant_id, feature_key)
2. Calls `invalidateFeatures(tenant_id)`

---

## 7. Known risks and tripwires

Real bugs or single-points-of-failure. Check these first when something weird happens.

### Risk: Single-token-per-member session
- **What**: `members.session_token` is a scalar column. Log in on phone → desktop's session invalidates.
- **Symptom**: Member reports being logged out of their laptop after using the mobile portal.
- **Fix**: Known Tier 2 follow-up. Multi-session table design documented but not yet built.
- **Mitigation**: 7-day default + 90-day Remember-me session TTLs reduce the friction. Recommend to members: "stay on one primary device."

### Risk: Stripe webhook endpoint still single-tenant
- **What**: `pages/api/stripe-webhook.js` resolves tenant from member lookup by stripe_customer_id, works for today because only HG has live Stripe. When a second real tenant goes live, this approach creates ambiguity.
- **Symptom**: Won't manifest until tenant #2 processes their first live payment.
- **Fix**: Phase 7C migration — per-tenant webhook URLs `/api/stripe-webhook/[slug].js` using the tenant's `webhook_secret` from `tenant_stripe_config`. Not yet built.
- **Trip test**: Before onboarding a real paying second tenant, complete Phase 7C.

### Risk: app_settings per-user keying
- **What**: Admin personal prefs (accent color, personal logo, font pref) are keyed by `user_id` only, not `(user_id, tenant_id)`. Admins working across tenants see the same prefs everywhere.
- **Symptom**: You see Hour Golf's admin-chosen accent color when you log into a different tenant's admin as the same user.
- **Fix**: Migrate to composite key. Cosmetic, low priority.

### Risk: monthly_usage view is SECURITY DEFINER
- **What**: `public.monthly_usage` view runs with creator privileges to bypass RLS. Necessary today because authenticated-role can't set `app.tenant_id`. Supabase advisor flags this as `security_definer_view`.
- **Symptom**: Not exploitable — the view correctly filters by `tenant_id` post-fix, so cross-tenant leak is closed. But advisor warning persists.
- **Fix**: Rework RLS to set `app.tenant_id` from JWT claim, then switch view to SECURITY INVOKER. Bigger project.

### Risk: Seam code creation is time-sensitive
- **What**: Edge function cron runs every 2 min. Code creation requires Seam API latency + Resend email latency (~2-5s total). If code_start is just ahead of cron tick, there can be a brief window where the code isn't yet valid at the lock.
- **Symptom**: Member tries code at the exact moment of their booking start, code rejected, lock enters anti-brute-force mode.
- **Mitigation**: Members trained to arrive a couple minutes early. Backup access code configured per tenant.

### Risk: Resend sandbox restriction on new tenants
- **What**: New tenants default to `tenants.email_from = null`, which falls back to `<name> <no-reply@ourlee.co>` — verified sender, good. But if somehow the fallback chain breaks and `onboarding@resend.dev` gets used, emails silently 403 for non-owner recipients.
- **Symptom**: "Why isn't my new tenant's members getting any emails?"
- **Check**: `select slug, email_from from tenants;` — none should be `resend.dev`.

### Risk: Member portal URL change breaks bookmarks
- **What**: Hour Golf was at `hour-golf.vercel.app` before the `ourlee.co` migration. Old bookmarks still work via middleware fallback, but cookies are domain-scoped — members who bookmarked the old URL have to re-login after following the redirect.
- **Mitigation**: Not a prod issue for HG (most members get the URL from their login email). Worth noting if complaints come in.

### Risk: Edge function cron keeps running after tenant deletion
- **What**: If you delete a tenant, any in-flight `access_code_jobs` rows for that tenant cascade-delete via FK. The edge function's next tick will see no jobs and no-op. No issue.
- **Symptom**: None known.

### Risk: Platform admin session conflict
- **What**: Browser holds one Supabase Auth session (`hg-auth` storage key). Logging into `/platform` with email A while logged into `<slug>.ourlee.co/admin` with email B will clobber one.
- **Mitigation**: Use separate browser profiles or incognito for parallel testing.

---

## 8. Emergency rollback procedures

### Roll back a migration

All migrations live in `supabase/migrations/`. Most have a paired `_rollback.sql` or document the reverse in their header comment. To roll back:

1. Read the migration file's rollback procedure
2. Run the reverse SQL in Supabase SQL editor
3. Verify application still works as expected
4. Update `git log` notes if behavior changes

For migrations without explicit rollback: generally, `DROP TABLE IF EXISTS ...` + `ALTER TABLE ... DROP COLUMN ...` will undo most forward migrations.

### Revert an edge function

Supabase Dashboard → Edge Functions → `<function_name>` → Deployments tab → find previous version → "Promote" or redeploy from that source. Source history preserved in Supabase.

### Revert a Vercel deployment

Vercel Dashboard → Deployments → find last known good deployment → "Promote to Production" (rollback). Takes ~30 seconds. Your git commits stay intact; only the live serving version changes. Next `git push` will re-deploy whatever HEAD is.

### Disable a tenant globally

`update public.tenants set status = 'suspended' where slug = '<slug>';`
Subdomain 404s within the middleware cache window (~10s-60s).

### Revoke all admin sessions

`update public.admins set session_token = null;`  ← this doesn't exist. Admins use Supabase Auth JWTs which have 1h TTL. Global session revocation = rotate the Supabase JWT secret (Project Settings → API → JWT Settings → Rotate). All existing tokens invalidated immediately. All admins + members relog.

### Revoke all member sessions for a tenant

```sql
update public.members
set session_token = null, session_expires_at = null
where tenant_id = '<tenant-uuid>';
```
All members of that tenant relog on next page load. Useful for incident response.

### Stop all access-code creation platform-wide

Two paths:
- **Feature flag off for every tenant**: `update public.tenant_features set enabled = false where feature_key = 'access_codes';` Future bookings won't create jobs; in-flight jobs keep processing.
- **Pause the edge function**: Supabase Dashboard → Edge Functions → `process-access-codes` → pause. All code creation halts. Jobs stay in `pending`. Resume to process backlog.
