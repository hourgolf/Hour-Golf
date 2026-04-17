import ThemeCustomizer from "../settings/ThemeCustomizer";
import FontSelector from "../settings/FontSelector";
import LogoUpload from "../settings/LogoUpload";
import TenantBranding from "../settings/TenantBranding";

export default function SettingsView({ settings, updateSetting, apiKey, user, onLogout, onOpenSync }) {
  const checkLabelStyle = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    cursor: "pointer",
    textTransform: "none",
    fontWeight: 400,
    letterSpacing: 0,
    color: "var(--text)",
  };

  return (
    <div className="content">
      <h2 className="section-head" style={{ fontSize: 16, marginBottom: 20 }}>
        Dashboard Settings
      </h2>

      {/* Appearance */}
      <div className="tbl" style={{ padding: 20, marginBottom: 20 }}>
        <h3 style={{ fontFamily: "var(--font-display)", fontSize: 14, textTransform: "uppercase", letterSpacing: 2, color: "var(--primary)", marginBottom: 16 }}>
          Appearance
        </h3>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div>
            <ThemeCustomizer settings={settings} updateSetting={updateSetting} />
          </div>
          <div>
            <FontSelector settings={settings} updateSetting={updateSetting} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 16 }}>
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
        </div>
      </div>

      {/* Tenant Brand (platform-level) */}
      <div className="tbl" style={{ padding: 20, marginBottom: 20 }}>
        <h3 style={{ fontFamily: "var(--font-display)", fontSize: 14, textTransform: "uppercase", letterSpacing: 2, color: "var(--primary)", marginBottom: 6 }}>
          Tenant Brand
        </h3>
        <p className="muted" style={{ marginBottom: 16 }}>
          Platform-level brand controls. Changes here affect every member and admin
          view for this tenant. (Your personal dashboard preferences live below.)
        </p>
        <TenantBranding apiKey={apiKey} />
      </div>

      {/* Admin Preferences (per-user) */}
      <div className="tbl" style={{ padding: 20, marginBottom: 20 }}>
        <h3 style={{ fontFamily: "var(--font-display)", fontSize: 14, textTransform: "uppercase", letterSpacing: 2, color: "var(--primary)", marginBottom: 6 }}>
          Your Dashboard
        </h3>
        <p className="muted" style={{ marginBottom: 16 }}>
          Personal customization for your admin dashboard only. Does not affect members.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div>
            <LogoUpload settings={settings} updateSetting={updateSetting} apiKey={apiKey} />
          </div>

          <div className="mf">
            <label>Header Display</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={checkLabelStyle}>
                <input
                  type="checkbox"
                  className="chk"
                  checked={settings.showLogo !== false}
                  onChange={(e) => updateSetting("showLogo", e.target.checked)}
                />
                Show personal logo image
              </label>
              <label style={checkLabelStyle}>
                <input
                  type="checkbox"
                  className="chk"
                  checked={settings.showTitle !== false}
                  onChange={(e) => updateSetting("showTitle", e.target.checked)}
                />
                Show tenant brand logo in title
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
        </div>
      </div>

      {/* Data & Sync */}
      <div className="tbl" style={{ padding: 20, marginBottom: 20 }}>
        <h3 style={{ fontFamily: "var(--font-display)", fontSize: 14, textTransform: "uppercase", letterSpacing: 2, color: "var(--primary)", marginBottom: 16 }}>
          Data &amp; Sync
        </h3>
        <button
          className="btn primary"
          style={{ padding: "12px 24px", fontSize: 13 }}
          onClick={onOpenSync}
        >
          {"\u21C5"} Sync Bookings.
        </button>
      </div>

      {/* Account */}
      {user && (
        <div className="tbl" style={{ padding: 20, marginBottom: 20 }}>
          <h3 style={{ fontFamily: "var(--font-display)", fontSize: 14, textTransform: "uppercase", letterSpacing: 2, color: "var(--primary)", marginBottom: 16 }}>
            Account
          </h3>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              Signed in as <strong style={{ color: "var(--text)" }}>{user.email}</strong>
            </div>
            <button
              className="btn danger"
              style={{ padding: "10px 20px", fontSize: 13 }}
              onClick={onLogout}
            >
              Sign Out.
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
