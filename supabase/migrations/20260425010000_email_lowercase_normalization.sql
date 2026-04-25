-- Phase C: prevent future mixed-case emails from creating duplicate
-- accounts. (Phase A — manual merge of Zachary Lee's two records —
-- ran ad-hoc against prod via Supabase MCP and is logged in
-- admin_activity_log; no DDL involved, so no migration captured it.)
--
-- Two parts in this migration:
--
--   1. BEFORE INSERT/UPDATE triggers on the three high-traffic email
--      columns (members.email, bookings.customer_email,
--      payments.member_email) that auto-lowercase the NEW value.
--      Self-healing: even a forgotten lower() at a write site still
--      lands as lowercase in the DB.
--
--   2. One-shot UPDATE on existing rows to lowercase any historical
--      mixed-case data. Pre-flight (run before this migration was
--      drafted) confirmed no lowercase counterparts existed for the
--      remaining mixed-case emails, so a blanket UPDATE will not
--      collide on the members_tenant_email_unique index.
--
-- The Skedda booking-webhook and the Stripe charge handler will both
-- benefit from this without any code change — the trigger fires
-- whenever a row is INSERTed or its email column is UPDATEd, no
-- matter who issues the write.
--
-- Why a trigger instead of a CHECK constraint?
--   A CHECK would fail mixed-case writes loudly. That sounds good
--   until the failure happens during a Stripe webhook retry storm at
--   3am — better to self-heal silently. The trigger normalizes
--   without losing data.

-- 1. Shared trigger function. Reads a configurable column name from
--    TG_ARGV[0] so we don't need three near-identical functions.
CREATE OR REPLACE FUNCTION lowercase_email_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_col text := TG_ARGV[0];
  v_val text;
BEGIN
  EXECUTE format('SELECT ($1).%I', v_col) INTO v_val USING NEW;
  IF v_val IS NOT NULL AND v_val <> lower(v_val) THEN
    NEW := jsonb_populate_record(NEW, jsonb_build_object(v_col, lower(v_val)));
  END IF;
  RETURN NEW;
END$$;

-- 2. Attach to the three chokepoint tables.
DROP TRIGGER IF EXISTS members_email_lowercase ON members;
CREATE TRIGGER members_email_lowercase
  BEFORE INSERT OR UPDATE OF email ON members
  FOR EACH ROW EXECUTE FUNCTION lowercase_email_column('email');

DROP TRIGGER IF EXISTS bookings_customer_email_lowercase ON bookings;
CREATE TRIGGER bookings_customer_email_lowercase
  BEFORE INSERT OR UPDATE OF customer_email ON bookings
  FOR EACH ROW EXECUTE FUNCTION lowercase_email_column('customer_email');

DROP TRIGGER IF EXISTS payments_member_email_lowercase ON payments;
CREATE TRIGGER payments_member_email_lowercase
  BEFORE INSERT OR UPDATE OF member_email ON payments
  FOR EACH ROW EXECUTE FUNCTION lowercase_email_column('member_email');

-- 3. Backfill existing mixed-case rows. The trigger fires on UPDATE
--    OF email so re-setting email = email is enough to trigger
--    normalization on the three triggered tables.
UPDATE members  SET email          = email          WHERE email          <> lower(email);
UPDATE bookings SET customer_email = customer_email WHERE customer_email <> lower(customer_email);
UPDATE payments SET member_email   = member_email   WHERE member_email IS NOT NULL AND member_email <> lower(member_email);

-- 4. The other 14 email-columned tables don't get triggers (most are
--    app-only writers), but lowercase any historical mixed-case data
--    so the data set is clean today.
UPDATE loyalty_ledger         SET member_email = lower(member_email)   WHERE member_email IS NOT NULL AND member_email <> lower(member_email);
UPDATE access_code_jobs       SET customer_email = lower(customer_email) WHERE customer_email IS NOT NULL AND customer_email <> lower(customer_email);
UPDATE shop_orders            SET member_email = lower(member_email)   WHERE member_email IS NOT NULL AND member_email <> lower(member_email);
UPDATE shop_credits           SET member_email = lower(member_email)   WHERE member_email IS NOT NULL AND member_email <> lower(member_email);
UPDATE shop_requests          SET member_email = lower(member_email)   WHERE member_email IS NOT NULL AND member_email <> lower(member_email);
UPDATE shop_cart              SET member_email = lower(member_email)   WHERE member_email IS NOT NULL AND member_email <> lower(member_email);
UPDATE member_addresses       SET member_email = lower(member_email)   WHERE member_email IS NOT NULL AND member_email <> lower(member_email);
UPDATE news_dismissals        SET member_email = lower(member_email)   WHERE member_email IS NOT NULL AND member_email <> lower(member_email);
UPDATE birthday_bonus_ledger  SET member_email = lower(member_email)   WHERE member_email IS NOT NULL AND member_email <> lower(member_email);
UPDATE event_comments         SET member_email = lower(member_email)   WHERE member_email IS NOT NULL AND member_email <> lower(member_email);
UPDATE event_interests        SET member_email = lower(member_email)   WHERE member_email IS NOT NULL AND member_email <> lower(member_email);
UPDATE event_popup_dismissals SET member_email = lower(member_email)   WHERE member_email IS NOT NULL AND member_email <> lower(member_email);
UPDATE event_registrations    SET member_email = lower(member_email)   WHERE member_email IS NOT NULL AND member_email <> lower(member_email);
UPDATE member_preferences     SET email = lower(email)                 WHERE email IS NOT NULL AND email <> lower(email);
