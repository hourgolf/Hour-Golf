import { TIERS } from "../../lib/constants";

export default function TierSelect({ value, onChange, style }) {
  return (
    <select
      className="tier-sel"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={style}
    >
      {TIERS.map((t) => (
        <option key={t} value={t}>{t}</option>
      ))}
    </select>
  );
}
