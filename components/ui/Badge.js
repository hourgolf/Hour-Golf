import { TIER_COLORS } from "../../lib/constants";

export default function Badge({ tier, style, className = "" }) {
  const colors = TIER_COLORS[tier] || { bg: "#D1DFCB", text: "#35443B" };
  return (
    <span
      className={`badge ${className}`}
      style={{ background: colors.bg, color: colors.text, ...style }}
    >
      {tier}
    </span>
  );
}
