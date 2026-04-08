-- Run this in Supabase → SQL Editor → New Query
-- This creates the payments table for tracking Stripe charges

CREATE TABLE IF NOT EXISTS payments (
  id BIGSERIAL PRIMARY KEY,
  member_email TEXT NOT NULL,
  billing_month TIMESTAMPTZ NOT NULL,
  amount_cents INTEGER NOT NULL,
  stripe_payment_intent_id TEXT,
  status TEXT NOT NULL DEFAULT 'succeeded',
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Allow the anon key to read/write (same pattern as your other tables)
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access for anon" ON payments
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Index for fast lookups by member + month
CREATE INDEX idx_payments_member_month ON payments (member_email, billing_month);
