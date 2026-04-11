const TABS = [
  { key: "today", label: "Today", countKey: "todayCount" },
  { key: "week", label: "Week" },
  { key: "overview", label: "Monthly" },
  { key: "customers", label: "Customers" },
  { key: "tiers", label: "Config" },
];

export default function Nav({ view, setView, todayCount, detailName, onClearDetail }) {
  return (
    <nav className="nav">
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
    </nav>
  );
}
