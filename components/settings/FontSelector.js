import { FONT_CATEGORIES, FONTS } from "../../lib/constants";

export default function FontSelector({ settings, updateSetting }) {
  return (
    <div className="mf">
      <label>Typeface</label>
      <select
        className="tier-sel"
        value={settings.font}
        onChange={(e) => updateSetting("font", e.target.value)}
        style={{ width: "100%", padding: "10px 12px", fontSize: 13, fontFamily: settings.font }}
      >
        {Object.entries(FONT_CATEGORIES).map(([category, fonts]) => (
          <optgroup key={category} label={category}>
            {Object.entries(fonts).map(([k, v]) => (
              <option key={k} value={k} style={{ fontFamily: k }}>{v}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
