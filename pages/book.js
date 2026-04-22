// Public, unauthenticated /book route. The social-media-linkable
// counterpart to /members/book. Prospective members see tier pricing
// and 7-day bay availability WITHOUT logging in; tapping an available
// slot funnels them into the signup flow at /members?signup=1 with
// the slot info carried forward in the URL so they can complete the
// reservation once signed in.

import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import { useBranding } from "../hooks/useBranding";
import { resolveBays, resolveBayLabel } from "../lib/branding";

export { noCacheSSR as getServerSideProps } from "../lib/no-cache-ssr";

const TZ = "America/Los_Angeles";

function ymd(d) {
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

function buildDayRange(days) {
  const out = [];
  const today = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    out.push({
      key: ymd(d),
      label: d.toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" }),
      short: d.toLocaleDateString("en-US", { timeZone: TZ, weekday: "short" }),
      num: d.toLocaleDateString("en-US", { timeZone: TZ, day: "numeric" }),
    });
  }
  return out;
}

// 30-minute time-of-day grid for the bay × hour preview. Public-view
// only needs a coarse view — if a member wants 15-minute precision
// they can sign up + book in the real flow.
function buildSlots(startHour, endHour) {
  const slots = [];
  for (let h = startHour; h < endHour; h++) {
    slots.push({ key: `${String(h).padStart(2, "0")}:00`, hour: h, minute: 0 });
    slots.push({ key: `${String(h).padStart(2, "0")}:30`, hour: h, minute: 30 });
  }
  return slots;
}

function formatHour(h) {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

// Non-member booking window from tier_config. Defaults match the HG
// values (10am–8pm) so a new tenant without config shown gets sane
// bounds instead of an empty grid.
function nonMemberWindow(tiers) {
  const nm = (tiers || []).find((t) => t.tier === "Non-Member");
  if (!nm) return { start: 10, end: 20 };
  return {
    start: Number(nm.booking_hours_start ?? 10),
    end: Number(nm.booking_hours_end ?? 20),
  };
}

export default function PublicBookPage() {
  const branding = useBranding();
  const bays = useMemo(() => resolveBays(branding), [branding]);
  const bayLabel = resolveBayLabel(branding);

  const appName = branding?.app_name || "the club";
  const primary = branding?.primary_color || "#4C8D73";
  const cream = branding?.cream_color || "#EDF3E3";
  const text = branding?.text_color || "#35443B";
  const accent = branding?.accent_color || "#ddd480";
  // Prefer the cursive header wordmark on the public landing — reads
  // as a brand signature rather than the full welcome-page building
  // illustration. Falls back to welcome_logo or the legacy single-
  // slot logo if the tenant hasn't uploaded a header-specific asset.
  const logoUrl =
    branding?.header_logo_url ||
    branding?.welcome_logo_url ||
    branding?.logo_url ||
    null;
  const supportEmail = branding?.support_email || null;
  const supportPhone = branding?.support_phone || null;

  const [tiers, setTiers] = useState([]);
  // Visible tier cards on the public page. Drops anything with
  // is_public=false (e.g. the synthetic Non-Member row, and hidden
  // tenant-specific tiers like HG's Unlimited which the operator
  // shares privately rather than marketing). The unfiltered `tiers`
  // array is still used below for the availability window calc.
  const visibleTiers = useMemo(
    () => (tiers || []).filter((t) => t && t.is_public !== false),
    [tiers]
  );
  const [availability, setAvailability] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSlot, setSelectedSlot] = useState(null); // { bay, date, time }

  const days = useMemo(() => buildDayRange(7), []);
  const [selectedDate, setSelectedDate] = useState(days[0].key);

  // Initial load: fetch tiers once (cacheable) and availability for today.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/public-tiers")
      .then((r) => r.ok ? r.json() : { tiers: [] })
      .then((d) => { if (!cancelled) setTiers(d.tiers || []); })
      .catch(() => { if (!cancelled) setTiers([]); });
    return () => { cancelled = true; };
  }, []);

  // Availability re-fetches when date changes. Same endpoint the
  // members page uses, already public.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/customer-availability?date=${selectedDate}`)
      .then((r) => r.ok ? r.json() : { bookings: [] })
      .then((d) => { if (!cancelled) { setAvailability(d.bookings || []); setLoading(false); } })
      .catch(() => { if (!cancelled) { setAvailability([]); setLoading(false); } });
    return () => { cancelled = true; };
  }, [selectedDate]);

  const { start: openHour, end: closeHour } = useMemo(() => nonMemberWindow(tiers), [tiers]);
  const slots = useMemo(() => buildSlots(openHour, closeHour), [openHour, closeHour]);

  // Is a 30-min slot booked for this bay? Covers any booking whose
  // window overlaps the slot interval.
  function isBooked(bay, slotKey) {
    const [h, m] = slotKey.split(":").map(Number);
    const slotStart = new Date(`${selectedDate}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`);
    const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);
    return availability.some((b) => {
      if (b.bay !== bay) return false;
      const bs = new Date(b.booking_start);
      const be = new Date(b.booking_end);
      return bs < slotEnd && be > slotStart;
    });
  }

  const signupUrl = useMemo(() => {
    const base = "/members?signup=1";
    if (!selectedSlot) return base;
    // Pre-filled context carried across to the signup form. Once signed
    // up, the member lands on /members/dashboard (current signup flow);
    // they then tap Book from the nav. Future iteration: honor a
    // `return` param on /members to redirect back to /members/book
    // with bay+date+start selected.
    const params = new URLSearchParams({
      signup: "1",
      from: "book",
      bay: selectedSlot.bay,
      date: selectedSlot.date,
      start: selectedSlot.time,
    });
    return `/members?${params.toString()}`;
  }, [selectedSlot]);

  return (
    <>
      <Head>
        <title>Book a {bayLabel.toLowerCase()} at {appName}</title>
        <meta
          name="description"
          content={`See live availability and reserve a ${bayLabel.toLowerCase()} at ${appName}. Members book free; non-members pay per hour.`}
        />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>

      <main
        style={{
          minHeight: "100dvh",
          background: cream,
          color: text,
          fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
          paddingBottom: 40,
        }}
      >
        {/* Hero */}
        <section
          style={{
            background: primary,
            color: "#fff",
            padding: "36px 22px 44px",
            textAlign: "center",
          }}
        >
          {logoUrl && (
            <img
              src={logoUrl}
              alt={appName}
              style={{
                maxHeight: 72,
                maxWidth: "min(70vw, 300px)",
                marginBottom: 18,
                filter: "brightness(0) invert(1)",
              }}
            />
          )}
          <h1
            style={{
              margin: 0,
              fontSize: "clamp(26px, 6vw, 38px)",
              fontFamily: "var(--font-display, inherit)",
              lineHeight: 1.15,
              fontWeight: 700,
            }}
          >
            Book a {bayLabel.toLowerCase()}.
          </h1>
          <p
            style={{
              margin: "12px auto 0",
              maxWidth: 520,
              fontSize: 15,
              lineHeight: 1.5,
              opacity: 0.92,
            }}
          >
            Live availability below. Tap any open slot — we'll walk you through a quick signup so you can lock it in.
          </p>
        </section>

        {/* Top CTA — surfaces Sign in / Sign up right under the hero
            so returning members can jump to booking without hunting,
            and new prospects get a clear "Ready to book?" framing
            before the tier cards. Previously at the bottom of the page;
            moved up per 2026-04-22 feedback. The separate tier cards
            below still function as per-tier shortcuts into signup. */}
        <section style={{ maxWidth: 620, margin: "20px auto 0", padding: "0 22px" }}>
          <div
            style={{
              background: "rgba(255,255,255,0.6)",
              borderRadius: 14,
              padding: "18px 20px",
              textAlign: "center",
            }}
          >
            <h3 style={{ margin: "0 0 8px", fontSize: 17, fontFamily: "var(--font-display, inherit)" }}>
              Ready to book?
            </h3>
            <p style={{ margin: "0 0 14px", fontSize: 13, color: `${text}bb`, lineHeight: 1.5 }}>
              Takes under two minutes to create an account. If you're an existing member, sign in to jump straight to booking.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              <a
                href="/members?signup=1"
                style={{
                  flex: "1 1 160px",
                  background: primary,
                  color: "#fff",
                  padding: "12px 20px",
                  borderRadius: 12,
                  textDecoration: "none",
                  fontWeight: 700,
                  fontSize: 14,
                  fontFamily: "var(--font-display, inherit)",
                  textAlign: "center",
                  boxSizing: "border-box",
                }}
              >
                Sign up
              </a>
              <a
                href="/members"
                style={{
                  flex: "1 1 160px",
                  background: "transparent",
                  color: primary,
                  padding: "12px 20px",
                  borderRadius: 12,
                  textDecoration: "none",
                  fontWeight: 700,
                  fontSize: 14,
                  fontFamily: "var(--font-display, inherit)",
                  textAlign: "center",
                  border: `2px solid ${primary}`,
                  boxSizing: "border-box",
                }}
              >
                Sign in
              </a>
            </div>
            <p style={{ marginTop: 14, fontSize: 11, color: `${text}99` }}>
              Want to see how the app works first?{" "}
              <a href="/app" style={{ color: primary, fontWeight: 600 }}>How to install →</a>
            </p>
          </div>
        </section>

        {/* Tier pricing strip. Filtered to is_public=true in the client
            (see visibleTiers): Non-Member (walk-in — redundant since a
            prospect here isn't a member yet) and any tier the operator
            marked private (e.g. HG's Unlimited) are hidden. Full
            tier set is still used below for the availability window. */}
        {visibleTiers.length > 0 && (
          <section style={{ maxWidth: 920, margin: "0 auto", padding: "24px 20px 8px" }}>
            <h2
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: 1.4,
                textTransform: "uppercase",
                color: primary,
                margin: "0 0 14px",
              }}
            >
              Ways to play
            </h2>
            <div
              style={{
                display: "grid",
                gap: 10,
                gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
              }}
            >
              {visibleTiers.map((t) => {
                const isUnlimited = Number(t.included_hours) >= 99999;
                // Each card is a hyperlink to the join shortcut — tap
                // goes straight into signup + Stripe checkout.
                const joinSlug = t.tier.toLowerCase().replace(/\s+/g, "-");
                const commonStyle = {
                  background: "rgba(255,255,255,0.6)",
                  borderRadius: 12,
                  padding: "14px 16px",
                  border: `1px solid ${text}11`,
                  color: text,
                  textDecoration: "none",
                  display: "block",
                  transition: "transform 0.1s, box-shadow 0.1s",
                };
                const body = (
                  <>
                    <div style={{ fontWeight: 700, fontSize: 14, fontFamily: "var(--font-display, inherit)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                      <span>{t.tier}</span>
                      <span style={{ color: primary, fontSize: 16 }} aria-hidden="true">›</span>
                    </div>
                    <div style={{ margin: "6px 0", fontSize: 20, fontWeight: 700 }}>
                      ${Number(t.monthly_fee).toFixed(0)}<span style={{ fontSize: 12, opacity: 0.7 }}>/mo</span>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.78, lineHeight: 1.5 }}>
                      {isUnlimited ? "Unlimited hours" : `${Number(t.included_hours)} hrs / month`}
                      <br />
                      ${Number(t.overage_rate).toFixed(0)}/hr after
                      {Number(t.pro_shop_discount) > 0 && (
                        <>
                          <br />
                          {t.pro_shop_discount}% pro-shop discount
                        </>
                      )}
                    </div>
                    <div style={{ marginTop: 10, fontSize: 12, fontWeight: 700, color: primary }}>
                      Join {t.tier} →
                    </div>
                  </>
                );
                return (
                  <a key={t.tier} href={`/join/${joinSlug}`} style={commonStyle}>{body}</a>
                );
              })}
            </div>
          </section>
        )}

        {/* Availability section */}
        <section style={{ maxWidth: 920, margin: "0 auto", padding: "24px 20px 8px" }}>
          <h2
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 1.4,
              textTransform: "uppercase",
              color: primary,
              margin: "0 0 14px",
            }}
          >
            This week
          </h2>

          {/* Day picker */}
          <div style={{ display: "flex", overflowX: "auto", gap: 8, marginBottom: 16, paddingBottom: 4 }}>
            {days.map((d) => {
              const active = d.key === selectedDate;
              return (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => { setSelectedDate(d.key); setSelectedSlot(null); }}
                  style={{
                    flex: "0 0 auto",
                    padding: "10px 14px",
                    minWidth: 66,
                    borderRadius: 12,
                    border: "1px solid",
                    borderColor: active ? primary : `${text}22`,
                    background: active ? primary : "rgba(255,255,255,0.6)",
                    color: active ? "#fff" : text,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: 10, letterSpacing: 1, textTransform: "uppercase", opacity: 0.85 }}>{d.short}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>{d.num}</div>
                </button>
              );
            })}
          </div>

          {/* Time × bay grid */}
          <div
            style={{
              background: "rgba(255,255,255,0.6)",
              borderRadius: 12,
              padding: "12px",
              overflowX: "auto",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `80px repeat(${bays.length}, minmax(80px, 1fr))`,
                gap: 4,
                minWidth: `${80 + bays.length * 88}px`,
              }}
            >
              {/* Header row */}
              <div />
              {bays.map((b) => (
                <div
                  key={b}
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    color: primary,
                    textAlign: "center",
                    padding: "8px 6px",
                  }}
                >
                  {b}
                </div>
              ))}

              {/* Slot rows */}
              {slots.map((s) => (
                <div key={`row-${s.key}`} style={{ display: "contents" }}>
                  <div
                    style={{
                      fontSize: 11,
                      color: `${text}99`,
                      padding: "8px 6px",
                      textAlign: "right",
                    }}
                  >
                    {s.minute === 0 ? formatHour(s.hour) : ""}
                  </div>
                  {bays.map((b) => {
                    const booked = isBooked(b, s.key);
                    const thisSelected =
                      selectedSlot &&
                      selectedSlot.bay === b &&
                      selectedSlot.time === s.key &&
                      selectedSlot.date === selectedDate;
                    return (
                      <button
                        key={`${b}-${s.key}`}
                        type="button"
                        disabled={booked}
                        onClick={() => {
                          if (booked) return;
                          setSelectedSlot({ bay: b, date: selectedDate, time: s.key });
                        }}
                        style={{
                          height: 32,
                          borderRadius: 6,
                          border: "none",
                          background: booked
                            ? `${text}22`
                            : thisSelected
                              ? primary
                              : `${primary}18`,
                          color: thisSelected ? "#fff" : `${text}bb`,
                          cursor: booked ? "not-allowed" : "pointer",
                          fontSize: 10,
                          fontFamily: "inherit",
                          transition: "background 0.1s",
                        }}
                        title={booked ? "Booked" : "Available — tap to reserve"}
                        aria-label={booked ? `${b} ${s.key} booked` : `${b} ${s.key} available`}
                      >
                        {booked ? "" : thisSelected ? "✓" : ""}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {loading && (
              <div style={{ textAlign: "center", padding: "12px 0 2px", fontSize: 12, color: `${text}99` }}>
                Loading availability…
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "10px 4px", fontSize: 11, color: `${text}aa` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 14, height: 14, borderRadius: 4, background: `${primary}18`, display: "inline-block" }} />
              Available
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 14, height: 14, borderRadius: 4, background: `${text}22`, display: "inline-block" }} />
              Booked
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 14, height: 14, borderRadius: 4, background: primary, display: "inline-block" }} />
              Selected
            </div>
          </div>
        </section>

        {/* Sticky reserve CTA — appears when a slot is selected */}
        {selectedSlot && (
          <section
            style={{
              position: "sticky",
              bottom: 12,
              zIndex: 10,
              maxWidth: 620,
              margin: "10px auto 0",
              padding: "0 16px",
            }}
          >
            <div
              style={{
                background: "#fff",
                borderRadius: 16,
                padding: "14px 16px",
                boxShadow: "0 12px 36px rgba(0,0,0,0.18)",
                border: `2px solid ${primary}`,
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: primary, fontWeight: 700 }}>
                  Reserve this slot
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>
                  {selectedSlot.bay} · {selectedSlot.time} · {days.find((d) => d.key === selectedSlot.date)?.label}
                </div>
              </div>
              <a
                href={signupUrl}
                style={{
                  background: primary,
                  color: "#fff",
                  padding: "12px 18px",
                  borderRadius: 12,
                  textDecoration: "none",
                  fontWeight: 700,
                  fontSize: 14,
                  fontFamily: "var(--font-display, inherit)",
                }}
              >
                Sign up to book →
              </a>
            </div>
          </section>
        )}

        {(supportEmail || supportPhone) && (
          <section
            style={{
              maxWidth: 620,
              margin: "28px auto 0",
              padding: "16px 22px",
              borderTop: `1px solid ${text}22`,
              textAlign: "center",
              fontSize: 13,
              color: text,
              opacity: 0.75,
            }}
          >
            Questions? We're here:
            {supportEmail && (
              <> <a href={`mailto:${supportEmail}`} style={{ color: primary, fontWeight: 600 }}>{supportEmail}</a></>
            )}
            {supportEmail && supportPhone && " · "}
            {supportPhone && (
              <a href={`tel:${supportPhone.replace(/\s+/g, "")}`} style={{ color: primary, fontWeight: 600 }}>{supportPhone}</a>
            )}
          </section>
        )}
      </main>
    </>
  );
}
