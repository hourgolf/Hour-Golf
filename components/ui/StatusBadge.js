// Admin status chip (PAID, PARTIAL, UNPAID, NOW, etc.). Intent-driven
// colors so the same "warning" tone means the same thing across the
// dashboard and the operator learns the palette once.
//
// Distinct from Badge, which is tier-coded via tenant branding. This
// one has no tenant config — status colors are consistent across
// tenants on purpose.
//
// Member-visible badges still use inline colors for now; only admin
// surfaces (Overview, Detail, Customers) adopt StatusBadge so we
// don't need to visually verify every member email template in one
// pass.

const INTENT_COLORS = {
  success: { bg: "#4C8D73", text: "#EDF3E3" },
  info:    { bg: "var(--primary)", text: "#EDF3E3" },
  warning: { bg: "#C77B3C", text: "#EDF3E3" },
  danger:  { bg: "var(--danger, #C92F1F)", text: "#EDF3E3" },
  neutral: { bg: "var(--text-muted, #6b7d67)", text: "#EDF3E3" },
};

export default function StatusBadge({
  intent = "neutral",
  children,
  title,
  size = "sm",
  style,
}) {
  const colors = INTENT_COLORS[intent] || INTENT_COLORS.neutral;
  return (
    <span
      className="badge"
      style={{
        background: colors.bg,
        color: colors.text,
        fontSize: size === "sm" ? 9 : 10,
        ...style,
      }}
      title={title}
    >
      {children}
    </span>
  );
}
