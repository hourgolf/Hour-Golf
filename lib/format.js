import { TZ } from "./constants";

export function fT(d) {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
}

export function fD(d) {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TZ });
}

export function fDL(d) {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: TZ });
}

export function fDS(d) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ });
}

export function lds(d) {
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

export function tds() {
  return lds(new Date());
}

export function mL(iso) {
  const d = new Date(iso);
  const n = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${n[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function hrs(n) {
  return Number(n).toFixed(1) + "h";
}

export function dlr(n) {
  return "$" + Number(n).toFixed(2);
}

export function allD(n) {
  return Number(n) >= 99999 ? "\u221e" : Number(n) + "h";
}

// ---- Pacific-time month bucketing -----------------------------------------
//
// Members live in Pacific time and read dates as PT. Several places in the
// codebase used to bucket bookings by UTC month (Vercel runs UTC, so
// `new Date(yr, mo, 1)` rolls to UTC). That caused real bills to disagree
// with what members saw on their dashboard — a booking starting at
// 9pm PT on March 31 (= April 1 04:00 UTC) was billed in April but
// rendered to the member as a March booking. This helper produces UTC
// instants for the start + end of "the PT month containing `now`" so a
// PostgREST `gte`/`lt` filter on booking_start always matches what
// members and admins see in PT.
//
// PT alternates between PDT (UTC-7, summer) and PST (UTC-8, winter).
// We try the active offset first, fall back to the other; round-trip
// through Intl to verify the candidate truly maps to PT 00:00 on the 1st.
function ptFieldsFor(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const out = {};
  for (const p of parts) if (p.type !== "literal") out[p.type] = p.value;
  return out;
}

function ptMonthStartUTC(yr, mo /* 1-12 */) {
  const monthStr = String(mo).padStart(2, "0");
  // Try PDT first (April-October typically), fall back to PST.
  for (const offset of ["-07:00", "-08:00"]) {
    const candidate = new Date(`${yr}-${monthStr}-01T00:00:00${offset}`);
    const f = ptFieldsFor(candidate);
    if (
      Number(f.year) === yr &&
      Number(f.month) === mo &&
      f.day === "01" &&
      f.hour === "00"
    ) {
      return candidate;
    }
  }
  // Last-resort fallback (winter): assume PST.
  return new Date(`${yr}-${monthStr}-01T00:00:00-08:00`);
}

// { startISO, endISO, year, month } where month is 1-12.
export function pacificMonthWindow(now = new Date()) {
  const f = ptFieldsFor(now);
  const yr = Number(f.year);
  const mo = Number(f.month);
  const nextMo = mo === 12 ? 1 : mo + 1;
  const nextYr = mo === 12 ? yr + 1 : yr;
  return {
    startISO: ptMonthStartUTC(yr, mo).toISOString(),
    endISO: ptMonthStartUTC(nextYr, nextMo).toISOString(),
    year: yr,
    month: mo,
  };
}

// "YYYY-MM" tag for the Pacific month containing `now`. Used by anything
// that still keys by month-string (loyalty_ledger.period, payments.billing_month).
export function pacificMonthTag(now = new Date()) {
  const f = ptFieldsFor(now);
  return `${f.year}-${f.month}`;
}

// Window for an explicit "YYYY-MM" tag (e.g. when admin runs loyalty for
// a past month from the Config UI).
export function pacificMonthWindowFor(tag /* "YYYY-MM" */) {
  const [yr, mo] = String(tag).split("-").map(Number);
  if (!yr || !mo) return pacificMonthWindow();
  const nextMo = mo === 12 ? 1 : mo + 1;
  const nextYr = mo === 12 ? yr + 1 : yr;
  return {
    startISO: ptMonthStartUTC(yr, mo).toISOString(),
    endISO: ptMonthStartUTC(nextYr, nextMo).toISOString(),
    year: yr,
    month: mo,
  };
}
