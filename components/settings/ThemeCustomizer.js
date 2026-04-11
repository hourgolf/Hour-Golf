import { THEMES } from "../../lib/constants";

export default function ThemeCustomizer({ settings, updateSetting }) {
  const currentColor = settings.customColor || (THEMES[settings.theme] || THEMES.augusta).primary;

  function setColor(hex) {
    updateSetting("customColor", hex);
  }

  return (
    <div className="mf">
      <label>Accent Color</label>
      <div className="custom-color-row">
        <input
          type="color"
          value={currentColor}
          onChange={(e) => setColor(e.target.value)}
        />
        <input
          type="text"
          placeholder="#1a472a"
          value={settings.customColor || currentColor}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "" || /^#?[0-9a-fA-F]{0,6}$/.test(v)) {
              const hex = v.startsWith("#") ? v : v ? "#" + v : "";
              setColor(hex);
            }
          }}
        />
      </div>
    </div>
  );
}
