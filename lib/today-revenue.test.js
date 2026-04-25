import { describe, it, expect } from "vitest";
import { computeTodayRevenue, daysInPacificMonth, pacificDay, pacificMonth } from "./today-revenue.js";

const tierCfg = [
  { tier: "Non-Member",   monthly_fee:   0, included_hours:     0, overage_rate: 60 },
  { tier: "Patron",       monthly_fee:  75, included_hours:     2, overage_rate: 30 },
  { tier: "Starter",      monthly_fee: 150, included_hours:     6, overage_rate: 25 },
  { tier: "Green Jacket", monthly_fee: 240, included_hours:    12, overage_rate: 20 },
  { tier: "Unlimited",    monthly_fee: 200, included_hours: 99999, overage_rate: 20 },
];

// Helpers — Pacific is UTC-7 in PDT. Build ISO timestamps so the
// Pacific-day bucket lands where we expect.
function ptIso(dateStr, time = "10:00:00") {
  // Naïve approach: append PDT offset. Tests run in UTC, so this
  // is enough to keep the toLocaleDateString PT-bucket stable.
  return `${dateStr}T${time}-07:00`;
}

function bk({ id = "b", email, name = "Test", start, durationHours, tier = "Non-Member", status = "Confirmed" }) {
  const startDate = new Date(start);
  const endDate = new Date(startDate.getTime() + durationHours * 3600 * 1000);
  return {
    booking_id: id,
    customer_email: email,
    customer_name: name,
    booking_start: startDate.toISOString(),
    booking_end: endDate.toISOString(),
    duration_hours: durationHours,
    tier,
    booking_status: status,
  };
}

describe("daysInPacificMonth", () => {
  it("returns 30 for April", () => expect(daysInPacificMonth("2026-04-15")).toBe(30));
  it("returns 31 for May", () => expect(daysInPacificMonth("2026-05-01")).toBe(31));
  it("handles leap-year February", () => expect(daysInPacificMonth("2024-02-12")).toBe(29));
  it("falls back to 30 on garbage", () => expect(daysInPacificMonth("nope")).toBe(30));
});

describe("pacificDay / pacificMonth", () => {
  it("buckets a 9pm PT booking on Apr 30 into April", () => {
    // 9pm PT Apr 30 = 04:00Z May 1 — should still land in 2026-04
    const iso = "2026-04-30T21:00:00-07:00";
    expect(pacificDay(iso)).toBe("2026-04-30");
    expect(pacificMonth(iso)).toBe("2026-04");
  });
});

describe("computeTodayRevenue — non-member only", () => {
  it("counts non-member hours × $60", () => {
    const bookings = [
      bk({ id: "1", email: "walk@in.com", start: ptIso("2026-04-15", "12:00:00"), durationHours: 1, tier: "Non-Member" }),
      bk({ id: "2", email: "walk2@in.com", start: ptIso("2026-04-15", "14:00:00"), durationHours: 0.5, tier: "Non-Member" }),
    ];
    const out = computeTodayRevenue({ bookings, members: [], tierCfg, viewDate: "2026-04-15", includeMrr: false });
    expect(out.nonMember).toBe(90); // 1.5h × $60
    expect(out.memberOverage).toBe(0);
    expect(out.total).toBe(90);
  });
});

describe("computeTodayRevenue — member with no overage", () => {
  it("returns $0 for members under their allotment", () => {
    const members = [{ email: "m@x.com", tier: "Starter", monthly_rate: null }];
    const bookings = [
      bk({ id: "1", email: "m@x.com", start: ptIso("2026-04-15", "10:00:00"), durationHours: 2, tier: "Starter" }),
    ];
    const out = computeTodayRevenue({ bookings, members, tierCfg, viewDate: "2026-04-15", includeMrr: false });
    expect(out.memberOverage).toBe(0);
    expect(out.breakdown).toEqual([]);
  });
});

describe("computeTodayRevenue — member tipping into overage today", () => {
  it("only counts the slice past the included threshold", () => {
    // Patron = 2h included @ $30 overage. Member already had 1.5h
    // earlier this month. Today they book 1h — that pushes them to
    // 2.5h. Overage portion = 0.5h × $30 = $15.
    const members = [{ email: "p@x.com", tier: "Patron", monthly_rate: null }];
    const bookings = [
      bk({ id: "earlier", email: "p@x.com", start: ptIso("2026-04-10", "10:00:00"), durationHours: 1.5, tier: "Patron" }),
      bk({ id: "today",   email: "p@x.com", start: ptIso("2026-04-15", "10:00:00"), durationHours: 1.0, tier: "Patron" }),
    ];
    const out = computeTodayRevenue({ bookings, members, tierCfg, viewDate: "2026-04-15", includeMrr: false });
    expect(out.memberOverage).toBeCloseTo(15);
    expect(out.breakdown).toHaveLength(1);
    expect(out.breakdown[0].overage_hours).toBeCloseTo(0.5);
    expect(out.breakdown[0].overage_dollars).toBeCloseTo(15);
  });
});

describe("computeTodayRevenue — member already in overage", () => {
  it("counts the full booking duration when prior usage already exceeded the allotment", () => {
    // Patron at 2h included — already at 4h before today, books 1h
    // today. Full 1h is overage = 1 × $30 = $30.
    const members = [{ email: "p@x.com", tier: "Patron" }];
    const bookings = [
      bk({ id: "early", email: "p@x.com", start: ptIso("2026-04-05", "10:00:00"), durationHours: 4, tier: "Patron" }),
      bk({ id: "today", email: "p@x.com", start: ptIso("2026-04-15", "10:00:00"), durationHours: 1, tier: "Patron" }),
    ];
    const out = computeTodayRevenue({ bookings, members, tierCfg, viewDate: "2026-04-15", includeMrr: false });
    expect(out.memberOverage).toBeCloseTo(30);
  });
});

describe("computeTodayRevenue — Unlimited tier never accrues overage", () => {
  it("returns 0 for an Unlimited member who books a lot today", () => {
    const members = [{ email: "u@x.com", tier: "Unlimited" }];
    const bookings = [
      bk({ id: "today", email: "u@x.com", start: ptIso("2026-04-15", "10:00:00"), durationHours: 8, tier: "Unlimited" }),
    ];
    const out = computeTodayRevenue({ bookings, members, tierCfg, viewDate: "2026-04-15", includeMrr: false });
    expect(out.memberOverage).toBe(0);
  });
});

describe("computeTodayRevenue — MRR share", () => {
  it("divides total monthly_fee across paying members by days in the month", () => {
    const members = [
      { email: "p@x.com", tier: "Patron" },
      { email: "s@x.com", tier: "Starter" },
      { email: "x@x.com", tier: "Non-Member" }, // doesn't count
    ];
    // April has 30 days. MRR = $75 + $150 = $225 → daily ≈ $7.50
    const out = computeTodayRevenue({ bookings: [], members, tierCfg, viewDate: "2026-04-15" });
    expect(out.daysInMonth).toBe(30);
    expect(out.mrrTotal).toBe(225);
    expect(out.mrrShare).toBeCloseTo(7.5);
    expect(out.total).toBeCloseTo(7.5);
  });

  it("uses members.monthly_rate when set, falls back to tier monthly_fee", () => {
    const members = [
      { email: "custom@x.com", tier: "Patron", monthly_rate: 100 }, // override
      { email: "default@x.com", tier: "Patron", monthly_rate: null }, // fall back to $75
    ];
    const out = computeTodayRevenue({ bookings: [], members, tierCfg, viewDate: "2026-04-15" });
    expect(out.mrrTotal).toBe(175);
  });
});

describe("computeTodayRevenue — combined", () => {
  it("sums non-member + member overage + MRR share", () => {
    const members = [
      { email: "p@x.com", tier: "Patron" },
      { email: "s@x.com", tier: "Starter" },
    ];
    const bookings = [
      // Non-member walk-in today: 1h × $60 = $60
      bk({ id: "nm", email: "walk@in.com", start: ptIso("2026-04-15", "10:00:00"), durationHours: 1, tier: "Non-Member" }),
      // Patron earlier this month: 2h (exactly at allotment)
      bk({ id: "p1", email: "p@x.com", start: ptIso("2026-04-10", "10:00:00"), durationHours: 2, tier: "Patron" }),
      // Patron today: 1h fully overage = 1 × $30 = $30
      bk({ id: "p2", email: "p@x.com", start: ptIso("2026-04-15", "12:00:00"), durationHours: 1, tier: "Patron" }),
    ];
    // MRR: $75 + $150 = $225, /30 = $7.5
    const out = computeTodayRevenue({ bookings, members, tierCfg, viewDate: "2026-04-15" });
    expect(out.nonMember).toBe(60);
    expect(out.memberOverage).toBeCloseTo(30);
    expect(out.mrrShare).toBeCloseTo(7.5);
    expect(out.total).toBeCloseTo(97.5);
  });
});
