// Compute "Est Revenue" for the admin TodayView's KPI strip.
//
// The earlier implementation only counted non-member bookings × $60,
// so days where every booking was a member showed $0 even when those
// members tipped into paid overage. This helper produces a more
// meaningful number with three components:
//
//   1. nonMember:   today's Non-Member bookings × that tier's
//                   overage_rate (the previous behavior, now scoped
//                   so non-members don't cannibalize member overage).
//
//   2. memberOverage: for each member with at least one booking
//                   today, walk their bookings in Pacific-month
//                   order. Each of today's bookings contributes
//                   max(0, hours_after_booking - included) -
//                   max(0, hours_before_booking - included) overage
//                   hours × the booking's snapshot tier rate. This
//                   correctly handles the case where one booking
//                   straddles the included/overage boundary.
//
//   3. mrrShare:    sum of monthly_fee across paying members ÷
//                   days_in_current_pt_month. The "subscription
//                   accrual" share of today's revenue. Optional —
//                   the operator can hide it via the includeMrr
//                   flag, but it's on by default since the user
//                   explicitly requested it as part of the number.
//
// Returns { total, nonMember, memberOverage, mrrShare, breakdown }
// where breakdown is a per-member array of { email, name, tier,
// hours, overage_hours, overage_dollars } so the UI can surface a
// tooltip / detail view.

const PT_TZ = "America/Los_Angeles";

// Pacific YYYY-MM-DD for an ISO timestamp. Used to bucket bookings
// by their Pacific calendar day, not the UTC day they happen to land
// on (a 9pm PT booking on Apr 30 is UTC May 1 — that booking should
// count toward April for billing purposes).
export function pacificDay(iso) {
  if (!iso) return "";
  const d = iso instanceof Date ? iso : new Date(iso);
  return d.toLocaleDateString("en-CA", { timeZone: PT_TZ });
}

// Pacific YYYY-MM month tag for an ISO timestamp.
export function pacificMonth(iso) {
  return pacificDay(iso).slice(0, 7);
}

// Days in the Pacific month containing `dateStr` ("YYYY-MM-DD").
// Falls back to 30 if the input is malformed (rather than NaN that
// would corrupt downstream math).
export function daysInPacificMonth(dateStr) {
  const m = /^(\d{4})-(\d{2})-/.exec(dateStr);
  if (!m) return 30;
  const year = Number(m[1]);
  const month = Number(m[2]);
  // The 0th day of next month is the last day of this month.
  return new Date(year, month, 0).getDate();
}

// Look up a tier's config row, with sensible fallbacks. Non-member
// rate defaults to $60 (matches lib/overage's prior fallback).
function tierLookup(tierCfg, tierName) {
  const row = (tierCfg || []).find((t) => t.tier === tierName) || null;
  if (tierName === "Non-Member" && !row) {
    return { included: 0, rate: 60, monthlyFee: 0 };
  }
  return {
    included: Number(row?.included_hours ?? 0),
    rate: Number(row?.overage_rate ?? 0),
    monthlyFee: Number(row?.monthly_fee ?? 0),
  };
}

// Compute the overage portion of a single booking given the member's
// running total before the booking and their tier allotment.
function overageHoursForBooking(hoursBefore, durationHours, included) {
  const after = hoursBefore + durationHours;
  const overageBefore = Math.max(0, hoursBefore - included);
  const overageAfter = Math.max(0, after - included);
  return overageAfter - overageBefore;
}

export function computeTodayRevenue({
  bookings = [],
  members = [],
  tierCfg = [],
  viewDate,
  includeMrr = true,
}) {
  if (!viewDate) {
    return { total: 0, nonMember: 0, memberOverage: 0, mrrShare: 0, breakdown: [], daysInMonth: 0 };
  }

  const monthTag = viewDate.slice(0, 7);
  const daysInMonth = daysInPacificMonth(viewDate);

  // Active (non-cancelled) bookings in the same Pacific month as the
  // view date. These are what we walk for cumulative-hours math.
  const monthBookings = bookings.filter(
    (b) => b.booking_status !== "Cancelled" && pacificMonth(b.booking_start) === monthTag
  );

  // Today's bookings within the same month bucket.
  const todayBookings = monthBookings.filter(
    (b) => pacificDay(b.booking_start) === viewDate
  );

  // Non-member revenue from today. Uses the Non-Member tier's
  // overage_rate from tier_config (or $60 fallback).
  const nmTier = tierLookup(tierCfg, "Non-Member");
  let nonMember = 0;
  for (const b of todayBookings) {
    const t = b.tier || members.find((m) => m.email === b.customer_email)?.tier || "Non-Member";
    if (t !== "Non-Member") continue;
    nonMember += Number(b.duration_hours || 0) * nmTier.rate;
  }

  // Member overage: per-customer walk through their month's bookings.
  // Group today's bookings by customer to know whose totals we need.
  const todayByCustomer = new Map();
  for (const b of todayBookings) {
    const t = b.tier || members.find((m) => m.email === b.customer_email)?.tier || "Non-Member";
    if (t === "Non-Member") continue;
    const arr = todayByCustomer.get(b.customer_email) || [];
    arr.push(b);
    todayByCustomer.set(b.customer_email, arr);
  }

  let memberOverage = 0;
  const breakdown = [];

  for (const [email, todays] of todayByCustomer) {
    // Pull this customer's full month of bookings, sort by start time
    // so the "before today" running total is deterministic.
    const monthForCustomer = monthBookings
      .filter((b) => b.customer_email === email)
      .sort((a, b) => new Date(a.booking_start) - new Date(b.booking_start));

    // Cumulative hours BEFORE the first booking we encounter today.
    // We walk in order, splitting earlier-in-month bookings from
    // today's bookings — earlier ones go to runningHoursBefore;
    // today's go through the overage formula.
    let runningHours = 0;
    let memberOverageHours = 0;
    let memberOverageDollars = 0;
    let totalTodayHours = 0;
    let tierAtToday = null;

    for (const b of monthForCustomer) {
      const dur = Number(b.duration_hours || 0);
      const isToday = pacificDay(b.booking_start) === viewDate;

      if (!isToday) {
        runningHours += dur;
        continue;
      }

      // For today's bookings, use the booking's snapshot tier as the
      // billing-truth source. If it's missing (legacy data) fall back
      // to the member's current tier. Tier of the LAST today-booking
      // wins for the breakdown row's tier label.
      const t = b.tier || members.find((m) => m.email === email)?.tier || "Non-Member";
      tierAtToday = t;
      const cfg = tierLookup(tierCfg, t);
      const overHrs = overageHoursForBooking(runningHours, dur, cfg.included);
      memberOverageHours += overHrs;
      memberOverageDollars += overHrs * cfg.rate;
      totalTodayHours += dur;
      runningHours += dur;
    }

    if (memberOverageDollars > 0) {
      const m = members.find((mm) => mm.email === email) || null;
      breakdown.push({
        email,
        name: m?.name || email,
        tier: tierAtToday || m?.tier || "Non-Member",
        hours_today: totalTodayHours,
        overage_hours: memberOverageHours,
        overage_dollars: memberOverageDollars,
      });
      memberOverage += memberOverageDollars;
    }
  }

  // Sort breakdown by dollar amount descending so the biggest
  // contributors surface first in any tooltip.
  breakdown.sort((a, b) => b.overage_dollars - a.overage_dollars);

  // Subscription share — sum of monthly_fee across paying members
  // (using their tier's monthly_fee, since members.monthly_rate isn't
  // universally populated). Divided by days in this month so today's
  // share is a daily slice.
  let mrr = 0;
  if (includeMrr) {
    for (const m of members) {
      if (!m?.tier || m.tier === "Non-Member") continue;
      // members.monthly_rate (per-member override) wins if present;
      // otherwise fall back to the tier's monthly_fee.
      const explicit = Number(m.monthly_rate);
      if (Number.isFinite(explicit) && explicit > 0) {
        mrr += explicit;
        continue;
      }
      const cfg = tierLookup(tierCfg, m.tier);
      mrr += cfg.monthlyFee || 0;
    }
  }
  const mrrShare = includeMrr && daysInMonth > 0 ? mrr / daysInMonth : 0;

  return {
    total: nonMember + memberOverage + mrrShare,
    nonMember,
    memberOverage,
    mrrShare,
    mrrTotal: mrr,
    daysInMonth,
    breakdown,
  };
}
