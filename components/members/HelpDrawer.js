import { useState } from "react";

/* ── FAQ Data ─────────────────────────────────────── */
const FAQ_CATEGORIES = [
  {
    key: "access",
    label: "Access & Door Codes",
    icon: "\uD83D\uDD11",
    items: [
      {
        q: "My access code isn't working",
        a: null,
        troubleshoot: true,
      },
      {
        q: "What are the facility hours?",
        a: "Hour Golf is accessible 24/7 for members with a Starter tier or above. Non-member bookings are available 10 AM \u2013 8 PM.",
      },
      {
        q: "Can I bring a guest?",
        a: "Yes! Guests are welcome during your booked session. Just make sure they\u2019re with you when you enter. Guest fees may apply depending on your membership tier.",
      },
    ],
  },
  {
    key: "booking",
    label: "Booking & Cancellation",
    icon: "\uD83D\uDCC5",
    items: [
      {
        q: "How do I book a bay?",
        a: "Go to the \u201CBook a Bay\u201D tab, pick your date, bay, and time slot, then confirm. You\u2019ll get an email confirmation.",
      },
      {
        q: "How far in advance can I book?",
        a: "You can book up to 14 days in advance. Same-day bookings are available if slots are open.",
      },
      {
        q: "How do I cancel a booking?",
        a: "Go to your Dashboard and find the booking under \u201CUpcoming Bookings.\u201D Click \u201CCancel\u201D \u2014 cancellations must be made at least 6 hours before your start time.",
      },
      {
        q: "What\u2019s the cancellation policy?",
        a: "You can cancel free of charge up to 6 hours before your booking. Late cancellations or no-shows may be charged. Contact us if you have an emergency.",
      },
      {
        q: "Can I modify a booking?",
        a: "Currently you\u2019ll need to cancel and rebook. We\u2019re working on an edit feature!",
      },
    ],
  },
  {
    key: "billing",
    label: "Billing & Membership",
    icon: "\uD83D\uDCB3",
    items: [
      {
        q: "How does billing work?",
        a: "Monthly membership fees are charged automatically. Overage hours (usage beyond your included hours) are billed at your tier\u2019s overage rate at the end of the billing period.",
      },
      {
        q: "How do I update my payment method?",
        a: "Go to the Billing tab and click \u201CUpdate Card.\u201D You\u2019ll be redirected to our secure payment portal to update your card details.",
      },
      {
        q: "What are punch passes / bonus hours?",
        a: "Punch passes let you pre-purchase extra bay hours at a discount. They never expire and carry over month to month. Buy them on the Billing tab.",
      },
      {
        q: "How do I change my membership tier?",
        a: "Go to the Billing tab under \u201CMembership.\u201D You can upgrade or downgrade your plan. Changes take effect on your next billing cycle.",
      },
      {
        q: "How do I cancel my membership?",
        a: "On the Billing tab, scroll to the Membership section and click \u201CCancel Membership.\u201D Your access continues until the end of your current billing period.",
      },
    ],
  },
  {
    key: "account",
    label: "Account & Profile",
    icon: "\u2699\uFE0F",
    items: [
      {
        q: "How do I change my email or password?",
        a: "Go to the Account tab. You\u2019ll see separate sections for changing your email and password. Both require your current password to confirm.",
      },
      {
        q: "I forgot my password",
        a: "Contact us directly and we\u2019ll help you reset it. A self-service password reset feature is coming soon.",
      },
    ],
  },
  {
    key: "contact",
    label: "Contact Us",
    icon: "\uD83D\uDCE9",
    items: [
      {
        q: "How do I reach Hour Golf?",
        a: "Email us at hello@hour.golf or call/text (503) 206-2222. We typically respond within a few hours during business hours.",
      },
    ],
  },
];

/* ── Access Code Troubleshooting Steps ───────────── */
const ACCESS_STEPS = [
  {
    question: "Let\u2019s get you in. First \u2014 are you at the right entrance?",
    detail: "Make sure you\u2019re at the main front door, not the side or back entrance.",
    options: ["Yes, I\u2019m at the front door", "Let me check"],
    nextOnFirst: 1,
    nextOnSecond: null,
  },
  {
    question: "Try entering your code again slowly, one digit at a time.",
    detail: "Wait for each digit to register. Make sure you hear a beep after each press.",
    options: ["It worked!", "Still not working"],
    nextOnFirst: "resolved",
    nextOnSecond: 2,
  },
  {
    question: "Try pressing the \u201C*\u201D key first to clear any previous entry, then enter your code.",
    detail: "Sometimes a partial code from a previous attempt causes issues.",
    options: ["That fixed it!", "Still locked out"],
    nextOnFirst: "resolved",
    nextOnSecond: 3,
  },
  {
    question: "No worries \u2014 use backup code 2138 to get in.",
    detail: "Enter 2138 on the keypad. This is a temporary backup code. If this also doesn\u2019t work, call or text us at (503) 206-2222.",
    options: ["I\u2019m in, thanks!", "Backup code didn\u2019t work either"],
    nextOnFirst: "resolved",
    nextOnSecond: "escalate",
  },
];

/* ══════════════════════════════════════════════════ */
export default function HelpDrawer({ open, onClose }) {
  const [view, setView] = useState("categories");
  const [activeCat, setActiveCat] = useState(null);
  const [activeQ, setActiveQ] = useState(null);
  const [troubleStep, setTroubleStep] = useState(0);

  function reset() {
    setView("categories");
    setActiveCat(null);
    setActiveQ(null);
    setTroubleStep(0);
  }

  function openCategory(cat) {
    setActiveCat(cat);
    setActiveQ(null);
    setView("faq");
  }

  function openTroubleshoot() {
    setTroubleStep(0);
    setView("troubleshoot");
  }

  function handleTroubleOption(optIndex) {
    const step = ACCESS_STEPS[troubleStep];
    const next = optIndex === 0 ? step.nextOnFirst : step.nextOnSecond;
    if (next === "resolved") {
      setView("resolved");
    } else if (next === "escalate") {
      setView("escalate");
    } else if (next === null) {
      // stay on same step
    } else {
      setTroubleStep(next);
    }
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="help-backdrop" onClick={onClose} />

      {/* Drawer */}
      <div className="help-drawer">
        {/* Header */}
        <div className="help-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {view !== "categories" && (
              <button
                onClick={() => view === "faq" ? reset() : view === "troubleshoot" ? reset() : reset()}
                className="help-back"
              >
                {"\u2190"}
              </button>
            )}
            <span className="help-title">
              {view === "categories" && "How can we help?"}
              {view === "faq" && activeCat?.label}
              {view === "troubleshoot" && "Access Code Help"}
              {view === "resolved" && "You\u2019re all set!"}
              {view === "escalate" && "Let\u2019s get you help"}
            </span>
          </div>
          <button onClick={onClose} className="help-close">{"\u2715"}</button>
        </div>

        {/* Content */}
        <div className="help-body">

          {/* Category List */}
          {view === "categories" && (
            <div className="help-categories">
              {FAQ_CATEGORIES.map((cat) => (
                <button
                  key={cat.key}
                  className="help-cat-btn"
                  onClick={() => openCategory(cat)}
                >
                  <span className="help-cat-icon">{cat.icon}</span>
                  <span>{cat.label}</span>
                  <span className="help-cat-arrow">{"\u203A"}</span>
                </button>
              ))}
            </div>
          )}

          {/* FAQ List */}
          {view === "faq" && activeCat && (
            <div className="help-faq-list">
              {activeCat.items.map((item, i) => (
                <div key={i} className="help-faq-item">
                  <button
                    className="help-faq-q"
                    onClick={() => {
                      if (item.troubleshoot) {
                        openTroubleshoot();
                      } else {
                        setActiveQ(activeQ === i ? null : i);
                      }
                    }}
                  >
                    <span>{item.q}</span>
                    <span className="help-faq-toggle">
                      {item.troubleshoot ? "\u203A" : activeQ === i ? "\u2212" : "+"}
                    </span>
                  </button>
                  {activeQ === i && item.a && (
                    <div className="help-faq-a">{item.a}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Troubleshooting Flow */}
          {view === "troubleshoot" && (
            <div className="help-trouble">
              <div className="help-trouble-step">
                Step {troubleStep + 1} of {ACCESS_STEPS.length}
              </div>
              <p className="help-trouble-q">{ACCESS_STEPS[troubleStep].question}</p>
              <p className="help-trouble-detail">{ACCESS_STEPS[troubleStep].detail}</p>
              <div className="help-trouble-options">
                {ACCESS_STEPS[troubleStep].options.map((opt, i) => (
                  <button
                    key={i}
                    className={`help-trouble-btn ${i === 0 ? "primary" : ""}`}
                    onClick={() => handleTroubleOption(i)}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Resolved */}
          {view === "resolved" && (
            <div className="help-resolved">
              <div style={{ fontSize: 48, marginBottom: 16 }}>{"\u2705"}</div>
              <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Glad we could help!</p>
              <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>
                Enjoy your session. If you run into anything else, we&rsquo;re here.
              </p>
              <button className="help-trouble-btn primary" onClick={onClose}>
                Close.
              </button>
            </div>
          )}

          {/* Escalate */}
          {view === "escalate" && (
            <div className="help-resolved">
              <div style={{ fontSize: 48, marginBottom: 16 }}>{"\uD83D\uDCDE"}</div>
              <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>We&rsquo;ll get this sorted.</p>
              <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 8, lineHeight: 1.6 }}>
                Call or text us right now:
              </p>
              <a
                href="tel:5032062222"
                style={{ fontSize: 20, fontFamily: "var(--font-display)", color: "var(--primary)", textDecoration: "none", display: "block", marginBottom: 20 }}
              >
                (503) 206-2222
              </a>
              <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>
                Or email <a href="mailto:hello@hour.golf" style={{ color: "var(--primary)", fontWeight: 600 }}>hello@hour.golf</a>
              </p>
              <button className="help-trouble-btn" onClick={onClose}>
                Close.
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
