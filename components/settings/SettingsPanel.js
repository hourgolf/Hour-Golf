import Modal from "../ui/Modal";
import ThemeCustomizer from "./ThemeCustomizer";
import FontSelector from "./FontSelector";
import LogoUpload from "./LogoUpload";

export default function SettingsPanel({ open, onClose, settings, updateSetting, apiKey, onOpenSync }) {
  if (!open) return null;

  const checkLabelStyle = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    cursor: "pointer",
    textTransform: "none",
    fontWeight: 400,
    letterSpacing: 0,
    color: "var(--text)",
  };

  return (
    <Modal open={open} onClose={onClose}>
      <h2>Dashboard Settings</h2>

      <ThemeCustomizer settings={settings} updateSetting={updateSetting} />
      <FontSelector settings={settings} updateSetting={updateSetting} />

      <div className="mf">
        <label>Mode</label>
        <div className="settings-grid">
          <div className={`color-opt ${!settings.dark ? "active" : ""}`} onClick={() => updateSetting("dark", false)}>
            {"\u2606"} Light
          </div>
          <div className={`color-opt ${settings.dark ? "active" : ""}`} onClick={() => updateSetting("dark", true)}>
            {"\u25D1"} Dark
          </div>
        </div>
      </div>

      <div className="mf">
        <label>Density</label>
        <div className="settings-grid">
          <div className={`color-opt ${settings.density !== "compact" ? "active" : ""}`} onClick={() => updateSetting("density", "comfortable")}>
            Comfortable
          </div>
          <div className={`color-opt ${settings.density === "compact" ? "active" : ""}`} onClick={() => updateSetting("density", "compact")}>
            Compact
          </div>
        </div>
      </div>

      <LogoUpload settings={settings} updateSetting={updateSetting} apiKey={apiKey} />

      <div className="mf">
        <label>Header Display</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={checkLabelStyle}>
            <input
              type="checkbox"
              className="chk"
              checked={settings.showLogo !== false}
              onChange={(e) => updateSetting("showLogo", e.target.checked)}
            />
            Show logo image
          </label>
          <label style={checkLabelStyle}>
            <input
              type="checkbox"
              className="chk"
              checked={settings.showTitle !== false}
              onChange={(e) => updateSetting("showTitle", e.target.checked)}
            />
            Show &ldquo;HOUR GOLF&rdquo; title
          </label>
          <label style={checkLabelStyle}>
            <input
              type="checkbox"
              className="chk"
              checked={settings.showSubtitle !== false}
              onChange={(e) => updateSetting("showSubtitle", e.target.checked)}
            />
            Show &ldquo;Admin Dashboard&rdquo; subtitle
          </label>
        </div>
      </div>

      <div className="mf">
        <label>Data Sync</label>
        <button
          className="btn"
          style={{ width: "100%", padding: "10px 12px", fontSize: 13 }}
          onClick={() => {
            if (onOpenSync) onOpenSync();
            onClose();
          }}
        >
          {"\u21C5"} Sync Bookings
        </button>
      </div>

      <div className="macts">
        <button className="btn primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}
