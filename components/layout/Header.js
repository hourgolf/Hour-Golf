import { useBranding } from "../../hooks/useBranding";

export default function Header({
  todayCount, todayHours, memberCount,
  onHome, logoUrl, logoScale,
  showLogo, showTitle, showSubtitle,
}) {
  const branding = useBranding();
  const tenantHeaderLogoUrl = branding?.header_logo_url || branding?.logo_url;
  const tenantName = branding?.app_name || "Ourlee";

  const logoVisible = showLogo !== false && !!logoUrl;
  // Tenant header logo visibility combines the per-admin `showTitle`
  // setting (from the user's personal dashboard prefs) with the
  // platform-level `show_header_logo` tenant brand toggle. Title-as-
  // text falls back when the logo is hidden but show_header_title is on.
  const tenantHeaderLogoVisible =
    showTitle !== false &&
    branding?.show_header_logo !== false &&
    !!tenantHeaderLogoUrl;
  const tenantHeaderTitleVisible =
    !tenantHeaderLogoVisible && branding?.show_header_title === true;

  return (
    <header className="header">
      <div className="header-inner" style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center" }}>
        <button
          type="button"
          className="logo-btn"
          onClick={onHome}
          aria-label="Home"
          title="Go to Dashboard"
        >
          {logoVisible && (
            <img
              key={logoUrl}
              src={logoUrl}
              alt="Logo"
              className="hdr-logo-img"
              style={{ maxHeight: logoScale || 36, filter: "brightness(0) invert(0.95)" }}
            />
          )}
        </button>
        <div style={{ textAlign: "center" }}>
          {tenantHeaderLogoVisible && (
            <img src={tenantHeaderLogoUrl} alt={tenantName} className="hdr-title-logo" />
          )}
          {tenantHeaderTitleVisible && (
            <div
              className="hdr-title-logo"
              style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--bg)", letterSpacing: 1 }}
            >
              {tenantName}
            </div>
          )}
          {showSubtitle !== false && <div className="logo-sub">Admin Dashboard</div>}
        </div>
        <div className="header-stats">
          <div className="stat-box">
            <span className="stat-val">{todayCount}</span>
            <span className="stat-lbl">Bookings</span>
          </div>
          <div className="stat-box">
            <span className="stat-val">{todayHours.toFixed(1)}h</span>
            <span className="stat-lbl">Usage</span>
          </div>
          <div className="stat-box">
            <span className="stat-val">{memberCount}</span>
            <span className="stat-lbl">Members</span>
          </div>
        </div>
      </div>
    </header>
  );
}
