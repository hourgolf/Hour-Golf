const TABS = [
  { key: "today", label: "Today", countKey: "todayCount" },
  { key: "week", label: "Calendar" },
  { key: "overview", label: "Usage" },
  { key: "customers", label: "Customers" },
  { key: "events", label: "Events" },
  { key: "tiers", label: "Config" },
  { key: "reports", label: "Reports" },
  { key: "settings", label: "Settings" },
];

export default function Nav({ view, setView, todayCount, detailName, onClearDetail }) {
  return (
    <nav className="nav">
      <div className="nav-inner-wrap">
      {TABS.map(({ key, label, countKey }) => (
        <button
          key={key}
          className={`nav-btn ${view === key ? "active" : ""}`}
          onClick={() => { setView(key); onClearDetail(); }}
        >
          {label}
          {countKey && todayCount > 0 && key === "today" && (
            <span className="cnt">{todayCount}</span>
          )}
        </button>
      ))}
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
