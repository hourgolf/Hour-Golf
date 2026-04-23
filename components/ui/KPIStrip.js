// Shared KPI strip used across admin views (Today, Calendar, Customers,
// Reports). Renders the `.summary / .sum-item / .sum-val / .sum-lbl`
// pattern from globals.css so visual treatment stays identical — the
// point is NOT to restyle, just to collapse four separate inline
// implementations into one contract.
//
// Each item accepts:
//   label     — string (required), shown in the `.sum-lbl` row
//   value     — string | number | React node (required)
//   color     — CSS color for the value (e.g. "var(--danger)")
//   style     — extra styles for the outer div
//   title     — HTML tooltip
//   onClick   — click handler; makes the item show a pointer cursor
//   key       — optional stable key; falls back to label
//
// Falsy items are skipped so callers can inline conditionals:
//   <KPIStrip items={[
//     { label: "Customers", value: total },
//     summary.pastDue > 0 && { label: "Past Due", value: summary.pastDue, color: "var(--danger)" },
//   ]} />

export default function KPIStrip({ items }) {
  return (
    <div className="summary">
      {items.map((item, i) => {
        if (!item) return null;
        const valueStyle = item.color ? { color: item.color } : undefined;
        const outerStyle = item.onClick
          ? { cursor: "pointer", ...(item.style || {}) }
          : item.style;
        return (
          <div
            key={item.key || `${item.label}-${i}`}
            className="sum-item"
            style={outerStyle}
            title={item.title}
            onClick={item.onClick}
          >
            <span className="sum-val" style={valueStyle}>
              {item.value}
            </span>
            <span className="sum-lbl">{item.label}</span>
          </div>
        );
      })}
    </div>
  );
}
