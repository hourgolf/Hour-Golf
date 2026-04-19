import { TIER_COLORS } from "../../lib/constants";
import { useBranding } from "../../hooks/useBranding";

// Tier badge color resolution: tenant-defined `tier_colors` in
// branding wins; fall back to the legacy HG TIER_COLORS map; final
// fallback is a neutral cream-on-text scheme so untyped tiers on a
// freshly-onboarded tenant still render something legible.
export default function Badge({ tier, style, className = "" }) {
  const branding = useBranding();
  const map = branding?.tier_colors || TIER_COLORS;
  const colors = map[tier] || TIER_COLORS[tier] || { bg: "#D1DFCB", text: "#35443B" };
  return (
    <span
      className={`badge ${className}`}
      style={{ background: colors.bg, color: colors.text, ...style }}
    >
      {tier}
    </span>
  );
}
