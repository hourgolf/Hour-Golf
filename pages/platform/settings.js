// Personal UI prefs for the signed-in platform admin.
//
// Changes apply optimistically via usePlatformSettings (local state
// updates instantly + mutates data-* attributes on <html>, the server
// save is debounced). So clicking an accent swatch shows the color
// change right as you click.

import { usePlatformAuth } from "../../hooks/usePlatformAuth";
import { usePlatformSettings } from "../../hooks/usePlatformSettings";
import PlatformShell from "../../components/platform/PlatformShell";

const ACCENTS = [
  { key: "emerald", label: "Emerald", swatch: "#10b981" },
  { key: "blue",    label: "Blue",    swatch: "#3b82f6" },
  { key: "teal",    label: "Teal",    swatch: "#14b8a6" },
  { key: "amber",   label: "Amber",   swatch: "#f59e0b" },
  { key: "slate",   label: "Slate",   swatch: "#475569" },
];

export default function PlatformSettingsPage() {
  const { apiKey, connected } = usePlatformAuth();
  const { settings, update, reset, saving } = usePlatformSettings({ apiKey, connected });

  return (
    <PlatformShell
      activeNav="settings"
      breadcrumbs={[{ label: "Settings" }]}
      title="Preferences"
      subtitle="Personal UI settings for your platform admin account. Applies everywhere you're signed in."
      actions={
        <>
          {saving && <span className="p-subtle" style={{ fontSize: 12 }}>Saving…</span>}
          <button className="p-btn" onClick={reset} title="Revert to defaults">
            Reset
          </button>
        </>
      }
    >
      <div className="p-stack" style={{ maxWidth: 720 }}>
        {/* Accent */}
        <div className="p-card">
          <div className="p-card-header">
            <div>
              <div className="p-card-title">Accent color</div>
              <div className="p-card-subtitle">
                Used for CTAs, active nav, status pills, and focus rings.
              </div>
            </div>
          </div>
          <div className="p-card-body">
            <div className="p-swatch-row">
              {ACCENTS.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  className={
                    "p-swatch" + (settings.accent === a.key ? " is-selected" : "")
                  }
                  onClick={() => update("accent", a.key)}
                  aria-pressed={settings.accent === a.key}
                >
                  <span
                    className="p-swatch-dot"
                    style={{ background: a.swatch }}
                  />
                  <span className="p-swatch-label">{a.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Density */}
        <div className="p-card">
          <div className="p-card-header">
            <div>
              <div className="p-card-title">Density</div>
              <div className="p-card-subtitle">
                Compact trims vertical padding on tables, buttons, and inputs —
                useful when you&rsquo;re scanning a lot of rows at once.
              </div>
            </div>
          </div>
          <div className="p-card-body">
            <div className="p-radio-group" role="radiogroup" aria-label="Density">
              <button
                type="button"
                role="radio"
                aria-checked={settings.density === "comfortable"}
                className={settings.density === "comfortable" ? "is-selected" : ""}
                onClick={() => update("density", "comfortable")}
              >
                Comfortable
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={settings.density === "compact"}
                className={settings.density === "compact" ? "is-selected" : ""}
                onClick={() => update("density", "compact")}
              >
                Compact
              </button>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="p-card">
          <div className="p-card-header">
            <div>
              <div className="p-card-title">Sidebar</div>
              <div className="p-card-subtitle">
                Collapse to an icon rail when you want more horizontal space.
              </div>
            </div>
          </div>
          <div className="p-card-body">
            <div className="p-radio-group" role="radiogroup" aria-label="Sidebar width">
              <button
                type="button"
                role="radio"
                aria-checked={!settings.sidebarCollapsed}
                className={!settings.sidebarCollapsed ? "is-selected" : ""}
                onClick={() => update("sidebarCollapsed", false)}
              >
                Expanded
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={settings.sidebarCollapsed}
                className={settings.sidebarCollapsed ? "is-selected" : ""}
                onClick={() => update("sidebarCollapsed", true)}
              >
                Icon rail
              </button>
            </div>
          </div>
        </div>

        <div className="p-subtle" style={{ fontSize: 11 }}>
          Preferences sync to your platform admin profile and apply on every
          device you sign in on. Stored in <code className="p-mono">platform_admin_settings</code>.
        </div>
      </div>
    </PlatformShell>
  );
}
