// Overage reconciliation helpers.
//
// The `monthly_usage` view computes `overage_charge` as a GROSS amount:
//   GREATEST(total_hours - included_hours, 0) * overage_rate
//
// It does NOT subtract payments already made. Before this helper existed,
// the admin's Charge button passed `overage_charge` straight through — so
// any partial payment (dashboard, Skedda, manual Stripe, etc.) would be
// double-charged on the next click. These helpers let the UI display and
// charge the NET amount still owed.
//
// Matching rules for "Overage" payments:
//   - Description starts with "Overage" (case-insensitive). Covers both
//     dashboard charges ("Overage \u2014 Apr 2026") and refund markers
//     ("Overage \u2014 Apr 2026 (refunded)").
//   - billing_month matches on YYYY-MM prefix only. Payments created
//     before the Pacific-bucket view migration (2026-04-19) stored the
//     month boundary as UTC midnight ("2026-04-01 00:00:00+00"); the
//     rebuilt view now returns the PT boundary ("2026-04-01 07:00:00+00"
//     in PDT). Both sides represent the start of the same billing
//     month — strict string equality missed this and painted every
//     already-collected overage as UNPAID. Comparing the shared YYYY-MM
//     prefix is stable across both timezone conventions.
//   - Only status === "succeeded" adds to paid. Refunds are represented
//     by flipping the original row's status to "refunded" (in-place),
//     which removes it from the sum automatically. Subtracting refunded
//     rows on top of that would double-count the refund — we saw this
//     with Peter Scher in Apr 2026 (refunded original + new successful
//     re-charge both present → net paid computed as 0, UI showed UNPAID).

// Normalize a billing_month value to a "YYYY-MM" tag. Works for any ISO-ish
// string that starts with "YYYY-MM-..." — which includes both the
// UTC-bucketed payments column and the PT-bucketed monthly_usage column.
function monthTag(billingMonth) {
  if (!billingMonth) return "";
  return String(billingMonth).slice(0, 7);
}

// Sum all overage payments in cents for (email, billing_month). Returns
// 0 if inputs are missing.
export function paidOverageCents(email, billingMonth, payments) {
  if (!email || !billingMonth || !Array.isArray(payments)) return 0;
  const usageTag = monthTag(billingMonth);
  if (!usageTag) return 0;
  return payments.reduce((sum, p) => {
    if (p.member_email !== email) return sum;
    if (monthTag(p.billing_month) !== usageTag) return sum;
    if (p.status !== "succeeded") return sum;
    const desc = p.description || "";
    if (!desc.toLowerCase().startsWith("overage")) return sum;
    return sum + (Number(p.amount_cents) || 0);
  }, 0);
}

// Given a monthly_usage row (with email + billing_month + overage_charge)
// and the full payments array, compute how many cents are still owed.
// Never returns < 0 (overpayment is treated as 0 remaining, not negative).
export function remainingOverageCents(usageRow, payments) {
  const expectedCents = Math.round(Number(usageRow?.overage_charge || 0) * 100);
  const email = usageRow?.customer_email || usageRow?.email;
  const paidCents = paidOverageCents(email, usageRow?.billing_month, payments);
  return Math.max(0, expectedCents - paidCents);
}

// Convenience for JSX: dollars (number), not cents.
export function remainingOverageUsd(usageRow, payments) {
  return remainingOverageCents(usageRow, payments) / 100;
}

// Classification for UI state.
//   - "none"     : no overage hours this month
//   - "paid"     : overage exists, fully paid (remaining = 0)
//   - "partial"  : overage exists, partially paid (0 < paid < expected)
//   - "unpaid"   : overage exists, nothing paid
//   - "sub_min"  : overage exists, remaining > 0 but < Stripe's $0.50 minimum
export function overageStatus(usageRow, payments) {
  const expectedCents = Math.round(Number(usageRow?.overage_charge || 0) * 100);
  if (expectedCents <= 0) return "none";
  const email = usageRow?.customer_email || usageRow?.email;
  const paidCents = paidOverageCents(email, usageRow?.billing_month, payments);
  const remainingCents = Math.max(0, expectedCents - paidCents);
  if (remainingCents === 0) return "paid";
  if (remainingCents < 50) return "sub_min";
  if (paidCents > 0) return "partial";
  return "unpaid";
}
