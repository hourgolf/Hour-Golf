import { useEffect, useState } from "react";
import { useTenantFeatures } from "../../hooks/useTenantFeatures";

// Bottom-docked nav for viewports ≤768px. Four primary slots plus a
// "More" sheet for the less-frequent views. Hidden above 768px via
// .nav-mobile { display: none } default in globals.css — paired with
// .nav { display: none } inside the mobile media query, so exactly
// one nav renders per viewport.
//
// Detail view: when the operator opens a member on mobile, view
// becomes "detail". NavMobile keeps Members as the active tab (Detail
// is contextually a deep-dive on Members) — tapping Members clears
// selection and returns to the list.

const PRIMARY_TABS = [
  { key: "today",     label: "Today",   icon: "\u2302" },   // ⌂ — the "today" home
  { key: "week",      label: "Calendar", icon: "\u25A3" },  // ▣ — week grid
  { key: "customers", label: "Members",  icon: "\u25CE" },  // ◎ — people ring
  { key: "__more__",  label: "More",     icon: "\u22EF" },  // ⋯ — more
];

const MORE_TABS = [
  { key: "reports",  label: "Reports" },
  { key: "events",   label: "Events", feature: "events" },
  { key: "shop",     label: "Pro Shop", feature: "pro_shop" },
  { key: "tiers",    label: "Config" },
  { key: "settings", label: "Settings" },
];

export default function NavMobile({ view, setView, todayCount, onClearDetail }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const { isEnabled } = useTenantFeatures();

  // Close the More sheet on ESC or when the view changes externally.
  useEffect(() => {
    if (!moreOpen) return;
    function onKey(e) { if (e.key === "Escape") setMoreOpen(false); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  // Keep the More sheet in sync: when the operator picks one of the
  // More destinations, close automatically.
  useEffect(() => { setMoreOpen(false); }, [view]);

  function tabActive(key) {
    if (key === "__more__") return moreOpen || MORE_TABS.some((t) => t.key === view);
    if (key === "customers" && view === "detail") return true;
    return view === key;
  }

  function handleTap(key) {
    if (key === "__more__") { setMoreOpen((m) => !m); return; }
    setMoreOpen(false);
    setView(key);
    if (onClearDetail) onClearDetail();
  }

  const visibleMoreTabs = MORE_TABS.filter((t) => !t.feature || isEnabled(t.feature));

  return (
    <>
      <nav className="nav-mobile" aria-label="Primary">
        {PRIMARY_TABS.map((t) => {
          const active = tabActive(t.key);
          return (
            <button
              key={t.key}
              type="button"
              className={`nav-mobile-btn ${active ? "active" : ""}`}
              onClick={() => handleTap(t.key)}
              aria-current={active ? "page" : undefined}
            >
              <span className="nav-mobile-icon" aria-hidden="true">{t.icon}</span>
              <span className="nav-mobile-label">
                {t.label}
                {t.key === "today" && todayCount > 0 && (
                  <span className="nav-mobile-cnt">{todayCount}</span>
                )}
              </span>
            </button>
          );
        })}
      </nav>

      {moreOpen && (
        <div
          className="nav-mobile-sheet-overlay"
          onClick={() => setMoreOpen(false)}
          role="presentation"
        >
          <div
            className="nav-mobile-sheet"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="More navigation"
          >
            <div className="nav-mobile-sheet-handle" />
            <div className="nav-mobile-sheet-title">Jump to</div>
            {visibleMoreTabs.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`nav-mobile-sheet-btn ${view === t.key ? "active" : ""}`}
                onClick={() => handleTap(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
