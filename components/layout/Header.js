export default function Header({
  todayCount, todayHours, memberCount,
  onHome, logoUrl, logoScale,
  showLogo, showTitle, showSubtitle,
}) {
  const logoVisible = showLogo !== false && !!logoUrl;
  const titleVisible = showTitle !== false;

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
          {titleVisible && (
            <img src="/blobs/HG-Script-White.svg" alt="Hour Golf" className="hdr-title-logo" />
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
