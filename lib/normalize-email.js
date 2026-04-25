// Canonical email normalizer. Use everywhere we read or write a
// customer email. The DB has BEFORE INSERT/UPDATE triggers on
// members.email, bookings.customer_email, and payments.member_email
// that auto-lowercase as a safety net (see migration
// 20260425010000_email_lowercase_normalization.sql) — but app code
// should still call this so equality compares against existing rows
// stay case-insensitive on the read side too. PostgREST query params
// are case-sensitive: a filter `email=eq.User@example.com` will not
// match a row stored as `user@example.com`.
//
// Returns null for null/undefined/empty input so callers don't have
// to special-case "is this a real email" before normalizing.
export function normalizeEmail(value) {
  if (value == null) return null;
  const s = String(value).trim().toLowerCase();
  return s.length === 0 ? null : s;
}

// Convenience alias for callers that prefer the shorter name.
export const lowerEmail = normalizeEmail;

export default normalizeEmail;
