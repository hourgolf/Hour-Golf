import { useState } from "react";
import { useBranding } from "../../hooks/useBranding";
import { useTenantFeatures } from "../../hooks/useTenantFeatures";
import { resolveHelpFaqs } from "../../lib/help-faqs";

// Strip everything that isn't a digit so `tel:` links work consistently
// regardless of how the tenant formats support_phone for display.
function telHref(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D+/g, "");
  return digits ? `tel:${digits}` : null;
}


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
    // The backup code + support phone are both tenant-specific. We leave
    // them as placeholders here and patch them in at render time from
    // branding (support_phone) + a tenant-scoped backup code field if we
    // ever add one. For now, if support_phone is configured it's shown.
    question: "No worries \u2014 let\u2019s get you through to the team.",
    detail: "__ESCALATE_TO_CONTACT__",
    options: ["I\u2019m in, thanks!", "Still locked out"],
    nextOnFirst: "resolved",
    nextOnSecond: "escalate",
  },
];

/* ══════════════════════════════════════════════════ */
export default function HelpDrawer({ open, onClose }) {
  const branding = useBranding();
  const { isEnabled } = useTenantFeatures();
  const accessCodesEnabled = isEnabled("access_codes");
  const faqCategories = resolveHelpFaqs(branding, { accessCodesEnabled });
  const supportEmail = branding?.support_email || null;
  const supportPhone = branding?.support_phone || null;
  const supportTelHref = telHref(supportPhone);
  const backupCode = accessCodesEnabled ? (branding?.backup_access_code || null) : null;

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
              {faqCategories.map((cat) => (
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
          {view === "troubleshoot" && (() => {
            const step = ACCESS_STEPS[troubleStep];
            let detail = step.detail;
            // The last step's detail is a placeholder — fill with live
            // support contact info if the tenant has it configured,
            // otherwise hide the sentence entirely (rather than show
            // HG-specific numbers).
            if (detail === "__ESCALATE_TO_CONTACT__") {
              const contactLine =
                supportPhone && supportEmail
                  ? `Call or text us at ${supportPhone}, or email ${supportEmail}.`
                  : supportPhone
                  ? `Call or text us at ${supportPhone}.`
                  : supportEmail
                  ? `Email us at ${supportEmail}.`
                  : "";
              detail = backupCode
                ? `Try backup code ${backupCode} first — it works on the keypad when your generated code fails.${contactLine ? " If that doesn't work: " + contactLine : ""}`
                : contactLine;
            }
            return (
            <div className="help-trouble">
              <div className="help-trouble-step">
                Step {troubleStep + 1} of {ACCESS_STEPS.length}
              </div>
              <p className="help-trouble-q">{step.question}</p>
              {detail && <p className="help-trouble-detail">{detail}</p>}
              <div className="help-trouble-options">
                {step.options.map((opt, i) => (
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
            );
          })()}

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
              {supportPhone && supportTelHref && (
                <>
                  <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 8, lineHeight: 1.6 }}>
                    Call or text us right now:
                  </p>
                  <a
                    href={supportTelHref}
                    style={{ fontSize: 20, fontFamily: "var(--font-display)", color: "var(--primary)", textDecoration: "none", display: "block", marginBottom: 20 }}
                  >
                    {supportPhone}
                  </a>
                </>
              )}
              {supportEmail && (
                <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>
                  {supportPhone ? "Or email " : "Email us at "}
                  <a href={`mailto:${supportEmail}`} style={{ color: "var(--primary)", fontWeight: 600 }}>
                    {supportEmail}
                  </a>
                </p>
              )}
              {!supportPhone && !supportEmail && (
                <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>
                  Please check with your venue staff directly.
                </p>
              )}
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
