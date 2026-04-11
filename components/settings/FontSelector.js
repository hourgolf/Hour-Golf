import { FONT_CATEGORIES, FONTS } from "../../lib/constants";

const SIZE_PRESETS = [
  { label: "XS", value: 11 },
  { label: "S", value: 12 },
  { label: "M", value: 13 },
  { label: "L", value: 14 },
  { label: "XL", value: 16 },
];

export default function FontSelector({ settings, updateSetting }) {
  const currentFontName = FONTS[settings.font] || "IBM Plex Mono";

  return (
    <>
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
      <div className="mf">
        <label>Font Size &mdash; {settings.fontSize || 13}px</label>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <input
            type="range"
            min={10}
            max={18}
            step={1}
            value={settings.fontSize || 13}
            onChange={(e) => updateSetting("fontSize", Number(e.target.value))}
            style={{ flex: 1, accentColor: "var(--primary)" }}
          />
          <div style={{ display: "flex", gap: 4 }}>
            {SIZE_PRESETS.map((p) => (
              <button
                key={p.label}
                className={`btn ${(settings.fontSize || 13) === p.value ? "primary" : ""}`}
                style={{ fontSize: 10, padding: "3px 8px" }}
                onClick={() => updateSetting("fontSize", p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
