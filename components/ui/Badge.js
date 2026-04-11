import { TIER_COLORS } from "../../lib/constants";

export default function Badge({ tier, style, className = "" }) {
  return (
    <span
      className={`badge ${className}`}
      style={{ background: TIER_COLORS[tier] || "#888", ...style }}
    >
      {tier}
    </span>
  );
}
