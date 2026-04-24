import { useTenantFeatures } from "../../hooks/useTenantFeatures";

// Each tab optionally gates on a feature flag. Items with no `feature`
// field always render (today, week, customers, tiers, reports are core
// tenant-admin functionality regardless of tenant).
// "Usage" (view=overview) removed from the nav 2026-04-23 — the
// member-overage + non-member-to-charge workflows moved into chip
// filters on the Customers tab so there's one place for per-customer
// work. The route still renders OverviewView if reached directly
// (?view=overview) as a safety net, but there's no UI path to it.
const TABS = [
  { key: "today", label: "Today", countKey: "todayCount" },
  { key: "inbox", label: "Inbox", countKey: "inboxCount" },
  { key: "week", label: "Calendar" },
  { key: "customers", label: "Customers" },
  { key: "events", label: "Events", feature: "events" },
  { key: "shop", label: "Shop", feature: "pro_shop" },
  { key: "tiers", label: "Config" },
  { key: "reports", label: "Reports" },
];

export default function Nav({ view, setView, todayCount, inboxCount, detailName, onClearDetail }) {
  const { isEnabled } = useTenantFeatures();
  const visibleTabs = TABS.filter((t) => !t.feature || isEnabled(t.feature));
  const counts = { todayCount, inboxCount };
  return (
    <nav className="nav">
      <div className="nav-inner-wrap">
      {visibleTabs.map(({ key, label, countKey }) => {
        const n = countKey ? counts[countKey] : 0;
        return (
          <button
            key={key}
            className={`nav-btn ${view === key ? "active" : ""}`}
            onClick={() => { setView(key); onClearDetail(); }}
          >
            {label}
            {n > 0 && <span className="cnt">{n}</span>}
          </button>
        );
      })}
      {detailName && (
        <button
          className={`nav-btn ${view === "detail" ? "active" : ""}`}
          onClick={() => setView("detail")}
        >
          {detailName}
        </button>
      )}
      </div>
    </nav>
  );
}
