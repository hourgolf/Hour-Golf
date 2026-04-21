// Unit tests for lib/overage.js.
//
// These are pure functions — no network, no DB, no mocks needed. The
// scenarios below encode the invariants that bit us in production:
//
//   1. Refunded-in-place rows must NOT be subtracted from paid (Peter
//      Scher Apr 2026 incident: original $180 flipped to "refunded",
//      new $180 inserted as "succeeded", naive subtraction produced 0
//      paid and UI showed UNPAID despite money having changed hands).
//   2. Refund-marker description ("Overage … (refunded)") must still
//      be classified as an overage row for status bookkeeping, not
//      silently ignored.
//   3. Partial-payment rendering: sub-$0.50 remainders get their own
//      bucket because Stripe won't charge below that floor.

import { describe, it, expect } from "vitest";
import {
  paidOverageCents,
  remainingOverageCents,
  remainingOverageUsd,
  overageStatus,
} from "./overage.js";

const EMAIL = "member@example.com";
const MONTH = "2026-03-01T00:00:00+00:00";

function payment(overrides = {}) {
  return {
    member_email: EMAIL,
    billing_month: MONTH,
    amount_cents: 6000,
    status: "succeeded",
    description: "Overage — Mar 2026",
    ...overrides,
  };
}

describe("paidOverageCents", () => {
  it("returns 0 when required inputs are missing", () => {
    expect(paidOverageCents(null, MONTH, [])).toBe(0);
    expect(paidOverageCents(EMAIL, null, [])).toBe(0);
    expect(paidOverageCents(EMAIL, MONTH, null)).toBe(0);
  });

  it("sums only succeeded overage rows for the target email + month", () => {
    const payments = [
      payment(),
      payment({ amount_cents: 4000 }),
      payment({ billing_month: "2026-04-01T00:00:00+00:00" }), // wrong month
      payment({ member_email: "other@example.com" }), // wrong member
      payment({ status: "refunded" }), // not succeeded
      payment({ description: "Punch pass" }), // not overage
    ];
    expect(paidOverageCents(EMAIL, MONTH, payments)).toBe(10000);
  });

  it("counts refund-marker rows with 'overage' prefix as long as they're succeeded", () => {
    // The refund marker is a NEW row inserted with a descriptive
    // suffix. If it's succeeded, it still counts toward paid. The
    // ACTUAL refund comes from flipping the original row to status=
    // refunded; the marker is just a human-readable note. This is
    // subtle but matches our prod behavior.
    const payments = [
      payment({ description: "Overage — Mar 2026 (refunded)", amount_cents: 6000 }),
    ];
    expect(paidOverageCents(EMAIL, MONTH, payments)).toBe(6000);
  });

  it("description prefix match is case-insensitive", () => {
    const payments = [payment({ description: "OVERAGE — Mar 2026" })];
    expect(paidOverageCents(EMAIL, MONTH, payments)).toBe(6000);
  });

  it("matches UTC-bucketed payment against PT-bucketed usage row (2026-04-20 regression)", () => {
    // The monthly_usage view was rebuilt on 2026-04-19 to bucket by
    // Pacific time, which moved its `billing_month` output from UTC
    // midnight ("2026-04-01 00:00:00+00") to PT midnight
    // ("2026-04-01 07:00:00+00" in PDT). Historic overage payments stay
    // at UTC midnight. Without YYYY-MM prefix matching, every already-
    // collected April overage painted as UNPAID.
    const utcPayment = payment({
      billing_month: "2026-04-01 00:00:00+00",
      description: "Overage — Apr 2026",
      amount_cents: 3000,
    });
    const ptUsageMonth = "2026-04-01 07:00:00+00";
    expect(paidOverageCents(EMAIL, ptUsageMonth, [utcPayment])).toBe(3000);
  });

  it("treats amount_cents null/undefined as 0, not NaN", () => {
    const payments = [payment({ amount_cents: null })];
    expect(paidOverageCents(EMAIL, MONTH, payments)).toBe(0);
  });
});

describe("remainingOverageCents", () => {
  it("returns the full expected amount when nothing is paid", () => {
    const row = { customer_email: EMAIL, billing_month: MONTH, overage_charge: 120 };
    expect(remainingOverageCents(row, [])).toBe(12000);
  });

  it("subtracts only succeeded overage payments", () => {
    const row = { customer_email: EMAIL, billing_month: MONTH, overage_charge: 120 };
    const payments = [
      payment({ amount_cents: 5000 }),
      payment({ amount_cents: 3000, status: "refunded" }), // ignored
    ];
    expect(remainingOverageCents(row, payments)).toBe(7000);
  });

  it("never returns negative when the member overpaid", () => {
    const row = { customer_email: EMAIL, billing_month: MONTH, overage_charge: 50 };
    const payments = [payment({ amount_cents: 7500 })];
    expect(remainingOverageCents(row, payments)).toBe(0);
  });

  it("falls back to usageRow.email when customer_email missing (admin view shape)", () => {
    const row = { email: EMAIL, billing_month: MONTH, overage_charge: 60 };
    const payments = [payment({ amount_cents: 2000 })];
    expect(remainingOverageCents(row, payments)).toBe(4000);
  });

  it("handles a zero overage_charge without dividing or NaN-ing", () => {
    const row = { customer_email: EMAIL, billing_month: MONTH, overage_charge: 0 };
    expect(remainingOverageCents(row, [])).toBe(0);
  });
});

describe("remainingOverageUsd", () => {
  it("converts remaining cents to dollars", () => {
    const row = { customer_email: EMAIL, billing_month: MONTH, overage_charge: 120 };
    const payments = [payment({ amount_cents: 5000 })];
    expect(remainingOverageUsd(row, payments)).toBe(70);
  });
});

describe("overageStatus", () => {
  const fullRow = { customer_email: EMAIL, billing_month: MONTH, overage_charge: 120 };

  it("'none' when overage_charge is 0", () => {
    expect(overageStatus({ ...fullRow, overage_charge: 0 }, [])).toBe("none");
  });

  it("'unpaid' when overage exists and no payments match", () => {
    expect(overageStatus(fullRow, [])).toBe("unpaid");
  });

  it("'partial' when paid > 0 but < expected, remaining >= 50 cents", () => {
    const payments = [payment({ amount_cents: 6000 })];
    expect(overageStatus(fullRow, payments)).toBe("partial");
  });

  it("'paid' when paid >= expected", () => {
    const payments = [payment({ amount_cents: 12000 })];
    expect(overageStatus(fullRow, payments)).toBe("paid");
  });

  it("'sub_min' when remaining is 1-49 cents (below Stripe floor)", () => {
    // Expected 120.25 (12025 cents), paid 120 (12000 cents) → 25 cents remaining
    const row = { customer_email: EMAIL, billing_month: MONTH, overage_charge: 120.25 };
    const payments = [payment({ amount_cents: 12000 })];
    expect(overageStatus(row, payments)).toBe("sub_min");
  });

  it("refunded row does NOT subtract from paid (the Peter Scher regression)", () => {
    // Scenario: original charge refunded in place (status=refunded),
    // new charge succeeded. Naive subtraction of refunded rows would
    // undercount paid and wrongly flag UNPAID. Correct behavior: only
    // succeeded rows sum; refunded rows are invisible to the math.
    const payments = [
      payment({ amount_cents: 12000, status: "refunded" }), // original
      payment({ amount_cents: 12000, status: "succeeded" }), // re-charge
    ];
    expect(overageStatus(fullRow, payments)).toBe("paid");
  });
});
