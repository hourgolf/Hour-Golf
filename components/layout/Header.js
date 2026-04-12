export default function Header({
  todayCount, todayHours, memberCount,
  onAddBooking, onRefresh, onSettings, onHome,
  loading, logoUrl, logoScale,
  showLogo, showTitle, showSubtitle,
}) {
  const logoVisible = showLogo !== false && !!logoUrl;
  const titleVisible = showTitle !== false;
  const subVisible = showSubtitle !== false;

  return (
    <header className="header">
      <div className="header-inner">
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
              style={{ maxHeight: logoScale || 36 }}
            />
          )}
          <div className="hdr-title-block">
            {titleVisible && <div className="logo">HOUR GOLF</div>}
            {subVisible && <div className="logo-sub">Admin Dashboard</div>}
          </div>
        </button>
        <div className="header-stats">
          <div className="stat-box">
            <span className="stat-val">{todayCount}</span>
            <span className="stat-lbl">Today</span>
          </div>
          <div className="stat-box">
            <span className="stat-val">{todayHours.toFixed(1)}h</span>
            <span className="stat-lbl">Bay Hrs</span>
          </div>
          <div className="stat-box">
            <span className="stat-val">{memberCount}</span>
            <span className="stat-lbl">Members</span>
          </div>
          <button className="hdr-btn" onClick={onAddBooking}><span className="hdr-btn-icon">+</span><span className="hdr-btn-text"> Booking</span></button>
          <button className="hdr-btn" onClick={onHome} title="Home"><span className="hdr-btn-icon">{"\u2302"}</span><span className="hdr-btn-text"> Home</span></button>
          <button className="hdr-btn" onClick={onRefresh} disabled={loading} title="Refresh">{"\u21BB"}</button>
          <button className="hdr-btn" onClick={onSettings} title="Settings">{"\u2699"}</button>
        </div>
      </div>
    </header>
  );
}
