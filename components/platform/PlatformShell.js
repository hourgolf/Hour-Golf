// Wrapper for every /platform page (except /platform/login, which has
// its own centered auth layout). Responsibilities:
//
//   1. Set <html data-surface="platform"> so styles/platform.css takes
//      over the CSS var cascade and shared components stop rendering in
//      the current subdomain's tenant colors.
//   2. Render the sidebar + topbar + content chrome.
//   3. Handle the "not a platform admin" redirect centrally so every
//      page doesn't re-implement it.
//
// Pages pass in breadcrumbs (array of { label, href? }), optional page
// title + subtitle + right-side actions, and their body as children.

import { useEffect } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import Head from "next/head";
import { usePlatformAuth } from "../../hooks/usePlatformAuth";
import { usePlatformSettings } from "../../hooks/usePlatformSettings";

function SidebarIcon({ d }) {
  return (
    <svg
      className="p-sidebar-nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

// Simple inline icons — a few strokes of SVG each. Keeping them inline
// avoids pulling a whole icon library for a surface with ~5 routes.
const ICON_TENANTS =
  "M3 21h18M5 21V7l7-4 7 4v14M10 9h4M10 13h4M10 17h4";
const ICON_SETTINGS =
  "M12 1v6m0 10v6M4.22 4.22l4.24 4.24m7.08 7.08l4.24 4.24M1 12h6m10 0h6M4.22 19.78l4.24-4.24m7.08-7.08l4.24-4.24";
const ICON_SIGNOUT =
  "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9";
const ICON_PLUS = "M12 5v14M5 12h14";
const ICON_SLIDERS =
  "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6";

export default function PlatformShell({
  children,
  breadcrumbs = [],
  title,
  subtitle,
  actions,
  activeNav = "tenants",
}) {
  const router = useRouter();
  const { apiKey, connected, authLoading, user, logout } = usePlatformAuth();

  // Load platform admin prefs — the hook also mutates <html> with
  // data-accent, data-density, data-sidebar so CSS reacts without
  // needing prop drilling. Returned for the sidebar-collapse toggle.
  const { settings } = usePlatformSettings({ apiKey, connected });

  // Scope CSS cascade. data-surface="platform" selector flips every
  // var override in styles/platform.css. Revert on unmount so member-
  // facing pages (a stacked-up soft-navigation in Next.js would leave
  // the attribute dangling otherwise) get their own branding back.
  useEffect(() => {
    const prev = document.documentElement.getAttribute("data-surface");
    document.documentElement.setAttribute("data-surface", "platform");
    return () => {
      if (prev === null) document.documentElement.removeAttribute("data-surface");
      else document.documentElement.setAttribute("data-surface", prev);
      // Clean up accent/density/sidebar so member surfaces don't inherit.
      document.documentElement.removeAttribute("data-accent");
      document.documentElement.removeAttribute("data-density");
      document.documentElement.removeAttribute("data-sidebar");
    };
  }, []);

  // Redirect if not an authorized platform admin. We show the shell
  // chrome while loading so the layout doesn't jump.
  useEffect(() => {
    if (!authLoading && !connected) router.replace("/platform/login");
  }, [connected, authLoading, router]);

  const loading = authLoading || !connected;

  return (
    <>
      <Head>
        <title>{title ? `${title} — Ourlee Platform` : "Ourlee Platform"}</title>
      </Head>
      <div className="p-shell">
        <aside className="p-sidebar">
          <div className="p-sidebar-brand">
            <div className="p-sidebar-brand-logo">O</div>
            <div className="p-sidebar-brand-text">
              <div className="p-sidebar-brand-name">Ourlee</div>
              <div className="p-sidebar-brand-sub">Platform</div>
            </div>
          </div>

          <div className="p-sidebar-section">Manage</div>

          <Link
            href="/platform"
            className={
              "p-sidebar-nav-item" +
              (activeNav === "tenants" ? " is-active" : "")
            }
            title="Tenants"
          >
            <SidebarIcon d={ICON_TENANTS} />
            <span>Tenants</span>
          </Link>

          <Link
            href="/platform/settings"
            className={
              "p-sidebar-nav-item" +
              (activeNav === "settings" ? " is-active" : "")
            }
            title="Settings"
          >
            <SidebarIcon d={ICON_SLIDERS} />
            <span>Settings</span>
          </Link>

          <div className="p-sidebar-footer">
            <div className="p-sidebar-user">
              <span className="p-sidebar-user-dot" />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {user?.email || "—"}
              </span>
            </div>
            <button
              className="p-btn p-btn--ghost p-btn--sm"
              onClick={logout}
              style={{ width: "100%", justifyContent: "flex-start", marginTop: 6 }}
            >
              <SidebarIcon d={ICON_SIGNOUT} />
              <span>Sign out</span>
            </button>
          </div>
        </aside>

        <div className="p-main">
          <div className="p-topbar">
            <nav className="p-breadcrumbs" aria-label="Breadcrumbs">
              {breadcrumbs.map((b, i) => {
                const isLast = i === breadcrumbs.length - 1;
                return (
                  <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    {i > 0 && <span className="p-breadcrumbs-sep" aria-hidden="true">/</span>}
                    {isLast || !b.href ? (
                      <span className={isLast ? "p-breadcrumbs-current" : ""}>{b.label}</span>
                    ) : (
                      <Link href={b.href}>{b.label}</Link>
                    )}
                  </span>
                );
              })}
            </nav>
            <div className="p-topbar-actions">{/* reserved for future user menu / notifications */}</div>
          </div>

          <main className="p-content">
            {loading ? (
              <div className="p-muted" style={{ padding: 40, textAlign: "center" }}>
                Loading…
              </div>
            ) : (
              <>
                {(title || actions) && (
                  <div className="p-page-header">
                    <div>
                      {title && <h1 className="p-page-title">{title}</h1>}
                      {subtitle && <div className="p-page-subtitle">{subtitle}</div>}
                    </div>
                    {actions && <div className="p-row" style={{ gap: 8 }}>{actions}</div>}
                  </div>
                )}
                {children}
              </>
            )}
          </main>
        </div>
      </div>
    </>
  );
}

// Re-export a common + icon so pages can use it in action buttons
// without each one re-defining the SVG markup.
export function PlusIcon() {
  return <SidebarIcon d={ICON_PLUS} />;
}
