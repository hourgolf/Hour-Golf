import { useEffect, useState } from "react";

// Tenant-level branding editor.
//
// Two operating modes, selected by whether tenantIdOverride is supplied:
//
// 1. TENANT-ADMIN MODE (default) — no tenantIdOverride. Fetches and
//    writes the CURRENT tenant's branding row via /api/admin-tenant-branding
//    (verifyAdmin, subdomain-scoped). Uploads go to /api/upload-logo and
//    /api/upload-font. This is what's mounted at
//    <slug>.ourlee.co/admin → Settings → Tenant Brand.
//
// 2. PLATFORM MODE — tenantIdOverride set to a target tenant UUID.
//    Fetches and writes that tenant's row via /api/platform-tenant-branding
//    (verifyPlatformAdmin). Uploads go to /api/platform-upload with kind
//    + tenant_id query params. Used inside /platform/tenants/[slug] so
//    super-admins can manage any tenant's branding.
//
// Scope (shared by both modes):
//   - 5 colors: primary, accent, danger, cream, text
//   - Logo upload (logos bucket)
//   - Background image upload (logos bucket)
//   - Display font: uploaded .woff2 OR Google Font name from curated list
//   - Body font: name from curated list
//
// What this intentionally does NOT do:
//   - Let admins pick arbitrary Google Fonts (curated list only)
//   - Modify structural CSS vars like --surface or --radius

const BODY_FONT_OPTIONS = [
  "DM Sans",
  "Inter",
  "Manrope",
  "Outfit",
  "Plus Jakarta Sans",
  "Work Sans",
  "Space Grotesk",
  "Syne",
];

// Display fonts: known Google options OR leave blank to use uploaded font.
// The tenant can type any name if they uploaded a custom font and want to
// reference it, but the dropdown shows the curated list.
const DISPLAY_FONT_OPTIONS = [
  "Biden Bold",
  "Bungee",
  "Playfair Display",
  "Syne",
  "DM Serif Display",
  "Fraunces",
];

const COLOR_FIELDS = [
  { key: "primary_color", label: "Primary", hint: "Main brand color (buttons, headers, nav)" },
  { key: "accent_color", label: "Accent", hint: "Highlights (FABs, tags)" },
  { key: "danger_color", label: "Danger", hint: "Destructive / error states" },
  { key: "cream_color", label: "Background", hint: "Page background + text on primary" },
  { key: "text_color", label: "Text", hint: "Primary body text color" },
];

// Compact logo slot with preview, upload, URL input, on/off toggle,
// and S/M/L size selector. Rendered three times in the Logos section
// — welcome, header, icon. Actual pixel sizing is enforced by the
// render sites via getLogoMaxDims; this UI only picks the bucket.
function LogoSlot({ label, hint, urlKey, toggleKey, sizeKey, uploadHandler, uploading, branding, update }) {
  const url = branding[urlKey];
  const enabled = branding[toggleKey] !== false;
  const size = branding[sizeKey] || "m";
  return (
    <div className="mf">
      <label>{label}</label>
      <div className="muted" style={{ fontSize: 11, marginTop: -4, marginBottom: 6 }}>{hint}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div
          style={{
            width: 64,
            height: 64,
            background: "var(--primary)",
            borderRadius: 6,
            padding: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            opacity: enabled ? 1 : 0.35,
          }}
        >
          {url ? (
            <img src={url} alt={label} style={{ maxWidth: "100%", maxHeight: "100%", filter: "brightness(0) invert(0.95)" }} />
          ) : (
            <span style={{ color: "rgba(237,243,227,0.5)", fontSize: 10 }}>none</span>
          )}
        </div>
        <input type="file" accept="image/*" onChange={uploadHandler} disabled={uploading} style={{ fontSize: 11, maxWidth: 140 }} />
      </div>
      <input
        type="text"
        value={url || ""}
        onChange={(e) => update(urlKey, e.target.value)}
        placeholder="https://..."
        style={{ width: "100%", padding: "4px 8px", border: "1px solid var(--border)", borderRadius: 4, fontFamily: "var(--font-mono)", fontSize: 10, background: "var(--surface)", color: "var(--text)" }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, fontSize: 12 }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => update(toggleKey, e.target.checked)}
          />
          <span>Show</span>
        </label>
        <div style={{ display: "inline-flex", gap: 2 }}>
          {["s", "m", "l"].map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => update(sizeKey, opt)}
              style={{
                padding: "2px 8px",
                fontSize: 11,
                background: size === opt ? "var(--primary)" : "var(--surface)",
                color: size === opt ? "var(--bg)" : "var(--text)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                cursor: "pointer",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>
      {uploading && <div className="muted" style={{ marginTop: 4 }}>Uploading…</div>}
    </div>
  );
}

export default function TenantBranding({ apiKey, tenantIdOverride }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [branding, setBranding] = useState(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [uploadingWelcome, setUploadingWelcome] = useState(false);
  const [uploadingHeader, setUploadingHeader] = useState(false);
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [uploadingPwaIcon, setUploadingPwaIcon] = useState(false);
  const [uploadingBg, setUploadingBg] = useState(false);
  const [uploadingFont, setUploadingFont] = useState(false);

  const isPlatform = !!tenantIdOverride;

  // Endpoint routing. Platform mode targets the super-admin endpoints
  // and carries tenant_id explicitly on every request; tenant-admin
  // mode uses the subdomain-scoped endpoints without it.
  const brandingGetUrl = isPlatform
    ? `/api/platform-tenant-branding?tenant_id=${encodeURIComponent(tenantIdOverride)}`
    : "/api/admin-tenant-branding";
  const brandingPatchUrl = isPlatform
    ? "/api/platform-tenant-branding"
    : "/api/admin-tenant-branding";
  function buildUploadUrl(kind, filename) {
    const fn = encodeURIComponent(filename);
    if (isPlatform) {
      return `/api/platform-upload?kind=${kind}&tenant_id=${encodeURIComponent(tenantIdOverride)}&filename=${fn}`;
    }
    const path = kind === "font" ? "upload-font" : "upload-logo";
    return `/api/${path}?filename=${fn}`;
  }

  // Load branding once on mount (or whenever the target tenant changes
  // in platform mode).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const r = await fetch(brandingGetUrl, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const d = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) {
          setError(d.detail || d.error || `Load failed (${r.status})`);
        } else {
          setBranding(d);
          setError("");
        }
      } catch (e) {
        if (!cancelled) setError(e.message || "Failed to load branding");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [apiKey, brandingGetUrl]);

  function update(key, value) {
    setBranding((b) => ({ ...b, [key]: value }));
    // Clear any stale status/error once the user starts editing again.
    setStatus("");
    setError("");
  }

  async function uploadAsset(file, kind, filenameBase, setUploading) {
    if (!file) return null;
    if (file.size > 4 * 1024 * 1024) {
      setError("File too large. Keep under 4MB.");
      return null;
    }
    setUploading(true);
    setError("");
    try {
      const ext = file.name.split(".").pop();
      const name = `${filenameBase}_${Date.now()}.${ext}`;
      const r = await fetch(buildUploadUrl(kind, name), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": file.type || "application/octet-stream",
        },
        body: file,
      });
      const d = await r.json().catch(async () => ({ detail: (await r.text().catch(() => "")) }));
      if (!r.ok) {
        if (r.status === 413) throw new Error("File too large for the server. Keep under 4MB.");
        throw new Error(d.detail || d.error || `Upload failed (${r.status})`);
      }
      return d.url;
    } catch (e) {
      setError(e.message || "Upload failed");
      return null;
    } finally {
      setUploading(false);
    }
  }

  async function handleWelcomeLogoUpload(e) {
    const url = await uploadAsset(e.target.files?.[0], "logo", "welcome", setUploadingWelcome);
    if (url) update("welcome_logo_url", url);
  }

  async function handleHeaderLogoUpload(e) {
    const url = await uploadAsset(e.target.files?.[0], "logo", "header", setUploadingHeader);
    if (url) update("header_logo_url", url);
  }

  async function handleIconUpload(e) {
    const url = await uploadAsset(e.target.files?.[0], "logo", "icon", setUploadingIcon);
    if (url) update("icon_url", url);
  }

  async function handlePwaIconUpload(e) {
    const url = await uploadAsset(e.target.files?.[0], "logo", "pwaicon", setUploadingPwaIcon);
    if (url) update("pwa_icon_url", url);
  }

  async function handleBgUpload(e) {
    const url = await uploadAsset(e.target.files?.[0], "bg", "bg", setUploadingBg);
    if (url) update("background_image_url", url);
  }

  async function handleFontUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".woff2")) {
      setError("Only .woff2 font files are supported.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("Font file too large. Keep under 2MB.");
      return;
    }
    const url = await uploadAsset(file, "font", "displayfont", setUploadingFont);
    if (url) update("font_display_url", url);
  }

  async function handleSave() {
    if (!branding) return;
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const payload = {};
      for (const { key } of COLOR_FIELDS) payload[key] = branding[key];
      payload.pwa_theme_color = branding.pwa_theme_color || branding.primary_color;
      payload.logo_url = branding.logo_url || null;
      payload.welcome_logo_url = branding.welcome_logo_url || null;
      payload.header_logo_url = branding.header_logo_url || null;
      payload.icon_url = branding.icon_url || null;
      payload.pwa_icon_url = branding.pwa_icon_url || null;
      payload.show_welcome_logo = branding.show_welcome_logo !== false;
      payload.show_welcome_title = branding.show_welcome_title !== false;
      payload.show_header_logo = branding.show_header_logo !== false;
      payload.show_header_title = branding.show_header_title === true;
      payload.show_icon = branding.show_icon === true;
      payload.welcome_logo_size = ["s", "m", "l"].includes(branding.welcome_logo_size) ? branding.welcome_logo_size : "m";
      payload.header_logo_size = ["s", "m", "l"].includes(branding.header_logo_size) ? branding.header_logo_size : "m";
      payload.icon_size = ["s", "m", "l"].includes(branding.icon_size) ? branding.icon_size : "m";
      payload.background_image_url = branding.background_image_url || null;
      payload.font_display_name = branding.font_display_name || null;
      payload.font_display_url = branding.font_display_url || null;
      payload.font_body_family = branding.font_body_family || null;
      payload.welcome_message = branding.welcome_message || null;
      payload.legal_url = branding.legal_url || null;
      payload.terms_url = branding.terms_url || null;
      payload.support_email = branding.support_email || null;
      payload.support_phone = branding.support_phone || null;
      payload.facility_hours = branding.facility_hours || null;
      payload.backup_access_code = branding.backup_access_code || null;
      // Operations panel — multi-tenant readiness fields. Each is
      // nullable; the underlying consumers fall back to platform
      // defaults (DEFAULT_BAYS, DEFAULT_CANCEL_CUTOFF_HOURS, etc.)
      // when null, so blanking a field reverts to defaults rather
      // than breaking anything.
      payload.cancel_cutoff_hours = (
        branding.cancel_cutoff_hours === "" || branding.cancel_cutoff_hours == null
          ? null
          : Number(branding.cancel_cutoff_hours)
      );
      payload.bays = Array.isArray(branding.bays) && branding.bays.length > 0
        ? branding.bays.map((b) => String(b).trim()).filter(Boolean)
        : null;
      payload.bay_label_singular = branding.bay_label_singular || null;
      payload.facility_address = branding.facility_address || null;
      // tier_colors lives as a JSON object on the row; the UI edits it
      // through a textarea (advanced) so we stash a `_tierColorsRaw`
      // string on the local branding object while editing and parse it
      // back to JSON here on save. Empty / unparseable string → null
      // (revert to fallback palette).
      if (branding._tierColorsRaw !== undefined) {
        const raw = String(branding._tierColorsRaw || "").trim();
        if (raw === "") {
          payload.tier_colors = null;
        } else {
          try {
            const parsed = JSON.parse(raw);
            payload.tier_colors = parsed;
          } catch (_) {
            throw new Error("Tier colors JSON is not valid. Fix or clear the field.");
          }
        }
      } else {
        payload.tier_colors = branding.tier_colors || null;
      }

      // Platform-mode PATCH requires the target tenant_id in the body
      // (tenant-admin mode resolves from subdomain, no extra field).
      if (isPlatform) payload.tenant_id = tenantIdOverride;

      const r = await fetch(brandingPatchUrl, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.detail || d.error || `Save failed (${r.status})`);
      setBranding(d);
      setStatus("Saved. Reload the page to see changes.");
    } catch (e) {
      setError(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="muted">Loading tenant branding…</div>;
  }
  if (!branding) {
    return <div style={{ color: "var(--red)" }}>{error || "Branding unavailable."}</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Colors */}
      <div>
        <h4 style={{ fontFamily: "var(--font-display)", fontSize: 12, textTransform: "uppercase", letterSpacing: 1.5, color: "var(--text-muted)", marginBottom: 10 }}>
          Colors
        </h4>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          {COLOR_FIELDS.map(({ key, label, hint }) => (
            <div key={key} className="mf">
              <label>{label}</label>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="color"
                  value={branding[key] || "#000000"}
                  onChange={(e) => update(key, e.target.value)}
                  style={{ width: 40, height: 32, padding: 0, border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer" }}
                />
                <input
                  type="text"
                  value={branding[key] || ""}
                  onChange={(e) => update(key, e.target.value)}
                  placeholder="#000000"
                  style={{ flex: 1, padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 4, fontFamily: "var(--font-mono)", fontSize: 12, background: "var(--surface)", color: "var(--text)" }}
                />
              </div>
              <div className="muted" style={{ marginTop: 4 }}>{hint}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Logos */}
      <div>
        <h4 style={{ fontFamily: "var(--font-display)", fontSize: 12, textTransform: "uppercase", letterSpacing: 1.5, color: "var(--text-muted)", marginBottom: 10 }}>
          Logos
        </h4>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
          <LogoSlot
            label="Welcome Logo"
            hint="Big hero on login pages"
            urlKey="welcome_logo_url"
            toggleKey="show_welcome_logo"
            sizeKey="welcome_logo_size"
            uploadHandler={handleWelcomeLogoUpload}
            uploading={uploadingWelcome}
            branding={branding}
            update={update}
          />
          <LogoSlot
            label="Header Logo"
            hint="Compact, shown in persistent nav"
            urlKey="header_logo_url"
            toggleKey="show_header_logo"
            sizeKey="header_logo_size"
            uploadHandler={handleHeaderLogoUpload}
            uploading={uploadingHeader}
            branding={branding}
            update={update}
          />
          <LogoSlot
            label="Icon"
            hint="Decorative mark (secondary)"
            urlKey="icon_url"
            toggleKey="show_icon"
            sizeKey="icon_size"
            uploadHandler={handleIconUpload}
            uploading={uploadingIcon}
            branding={branding}
            update={update}
          />
        </div>

        <div style={{ marginTop: 16, padding: 12, background: "var(--bg)", borderRadius: 8, fontSize: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 8, color: "var(--text-muted)" }}>Show tenant name as text:</div>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginRight: 18 }}>
            <input
              type="checkbox"
              checked={branding.show_welcome_title !== false}
              onChange={(e) => update("show_welcome_title", e.target.checked)}
            />
            <span>On login pages</span>
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={branding.show_header_title === true}
              onChange={(e) => update("show_header_title", e.target.checked)}
            />
            <span>In persistent header</span>
          </label>
        </div>
      </div>

      {/* PWA Icon (phone home-screen / browser tab) */}
      <div>
        <h4 style={{ fontFamily: "var(--font-display)", fontSize: 12, textTransform: "uppercase", letterSpacing: 1.5, color: "var(--text-muted)", marginBottom: 10 }}>
          PWA &amp; Browser Icon
        </h4>
        <div className="mf" style={{ maxWidth: 360 }}>
          <label>Home-screen / favicon (PNG, square, ≥512×512)</label>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
            Shown when a member installs this portal as an app, and as the
            browser tab icon. 1024×1024 recommended for crisp iOS rendering.
            Leave empty to use the default Ourlee icon.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            {branding.pwa_icon_url && (
              <div style={{ width: 64, height: 64, borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)", background: "var(--bg)" }}>
                <img src={branding.pwa_icon_url} alt="PWA icon" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
            )}
            <input type="file" accept="image/png" onChange={handlePwaIconUpload} disabled={uploadingPwaIcon} />
          </div>
          <input
            type="text"
            value={branding.pwa_icon_url || ""}
            onChange={(e) => update("pwa_icon_url", e.target.value)}
            placeholder="https://... or leave empty"
            style={{ width: "100%", padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 4, fontFamily: "var(--font-mono)", fontSize: 11, background: "var(--surface)", color: "var(--text)" }}
          />
          {uploadingPwaIcon && <div className="muted" style={{ marginTop: 4 }}>Uploading…</div>}
        </div>
      </div>

      {/* Background */}
      <div>
        <h4 style={{ fontFamily: "var(--font-display)", fontSize: 12, textTransform: "uppercase", letterSpacing: 1.5, color: "var(--text-muted)", marginBottom: 10 }}>
          Background
        </h4>
        <div className="mf" style={{ maxWidth: 360 }}>
          <label>Page background image (optional)</label>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            {branding.background_image_url && (
              <div style={{ width: 80, height: 80, borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)" }}>
                <img src={branding.background_image_url} alt="Background" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
            )}
            <input type="file" accept="image/*" onChange={handleBgUpload} disabled={uploadingBg} />
          </div>
          <input
            type="text"
            value={branding.background_image_url || ""}
            onChange={(e) => update("background_image_url", e.target.value)}
            placeholder="https://... or leave empty"
            style={{ width: "100%", padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 4, fontFamily: "var(--font-mono)", fontSize: 11, background: "var(--surface)", color: "var(--text)" }}
          />
          {uploadingBg && <div className="muted" style={{ marginTop: 4 }}>Uploading…</div>}
        </div>
      </div>

      {/* Fonts */}
      <div>
        <h4 style={{ fontFamily: "var(--font-display)", fontSize: 12, textTransform: "uppercase", letterSpacing: 1.5, color: "var(--text-muted)", marginBottom: 10 }}>
          Fonts
        </h4>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div className="mf">
            <label>Display Font</label>
            <input
              type="text"
              value={branding.font_display_name || ""}
              onChange={(e) => update("font_display_name", e.target.value)}
              list="display-font-options"
              placeholder="e.g. Biden Bold, Playfair Display"
              style={{ width: "100%", padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 4, fontSize: 13, background: "var(--surface)", color: "var(--text)" }}
            />
            <datalist id="display-font-options">
              {DISPLAY_FONT_OPTIONS.map((f) => <option key={f} value={f} />)}
            </datalist>
            <div className="muted" style={{ marginTop: 4 }}>
              Name must match either a Google Font (pre-loaded) or your uploaded .woff2 file.
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={{ fontSize: 11, color: "var(--text-muted)" }}>Upload custom .woff2</label>
              <input type="file" accept=".woff2" onChange={handleFontUpload} disabled={uploadingFont} />
              {branding.font_display_url && (
                <div className="muted" style={{ marginTop: 4, fontFamily: "var(--font-mono)", fontSize: 10, wordBreak: "break-all" }}>
                  Current: {branding.font_display_url}
                </div>
              )}
              {uploadingFont && <div className="muted" style={{ marginTop: 4 }}>Uploading font…</div>}
            </div>
          </div>

          <div className="mf">
            <label>Body Font</label>
            <select
              value={branding.font_body_family || "DM Sans"}
              onChange={(e) => update("font_body_family", e.target.value)}
              style={{ width: "100%", padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 4, fontSize: 13, background: "var(--surface)", color: "var(--text)" }}
            >
              {BODY_FONT_OPTIONS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
            <div className="muted" style={{ marginTop: 4 }}>
              Google Fonts in the curated list — all pre-loaded by the app.
            </div>
          </div>
        </div>
      </div>

      {/* Copy */}
      <div>
        <h4 style={{ fontFamily: "var(--font-display)", fontSize: 12, textTransform: "uppercase", letterSpacing: 1.5, color: "var(--text-muted)", marginBottom: 10 }}>
          Copy
        </h4>
        <div className="mf">
          <label>Login Welcome Message</label>
          <input
            type="text"
            value={branding.welcome_message || ""}
            onChange={(e) => update("welcome_message", e.target.value)}
            placeholder="Hello Friend."
            maxLength={200}
            style={{ width: "100%", padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 4, fontSize: 13, background: "var(--surface)", color: "var(--text)" }}
          />
          <div className="muted" style={{ marginTop: 4 }}>
            Shown under the logo on the member portal login screen. Leave blank to use a neutral default.
          </div>
        </div>
      </div>

      {/* Support & Legal */}
      <div>
        <h4 style={{ fontFamily: "var(--font-display)", fontSize: 12, textTransform: "uppercase", letterSpacing: 1.5, color: "var(--text-muted)", marginBottom: 10 }}>
          Support &amp; Legal
        </h4>
        <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 14 }}>
          These surface in the Help drawer, the signup consent checkbox, and the contact escalation flow. Leave blank and the matching UI section hides cleanly instead of showing someone else&rsquo;s info.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div className="mf">
            <label>Terms &amp; Conditions URL</label>
            <input
              type="text"
              value={branding.legal_url || ""}
              onChange={(e) => update("legal_url", e.target.value)}
              placeholder="https://..."
              style={{ width: "100%", padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 4, fontFamily: "var(--font-mono)", fontSize: 11, background: "var(--surface)", color: "var(--text)" }}
            />
          </div>
          <div className="mf">
            <label>Club Policies URL</label>
            <input
              type="text"
              value={branding.terms_url || ""}
              onChange={(e) => update("terms_url", e.target.value)}
              placeholder="https://..."
              style={{ width: "100%", padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 4, fontFamily: "var(--font-mono)", fontSize: 11, background: "var(--surface)", color: "var(--text)" }}
            />
          </div>
          <div className="mf">
            <label>Support Email</label>
            <input
              type="email"
              value={branding.support_email || ""}
              onChange={(e) => update("support_email", e.target.value)}
              placeholder="hello@example.com"
              maxLength={120}
              style={{ width: "100%", padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 4, fontSize: 13, background: "var(--surface)", color: "var(--text)" }}
            />
          </div>
          <div className="mf">
            <label>Support Phone</label>
            <input
              type="text"
              value={branding.support_phone || ""}
              onChange={(e) => update("support_phone", e.target.value)}
              placeholder="(555) 123-4567"
              maxLength={120}
              style={{ width: "100%", padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 4, fontSize: 13, background: "var(--surface)", color: "var(--text)" }}
            />
            <div className="muted" style={{ marginTop: 4 }}>Any display format. The tel: link strips non-digits automatically.</div>
          </div>
        </div>
        <div className="mf" style={{ marginTop: 14 }}>
          <label>Facility Hours (for FAQ)</label>
          <textarea
            value={branding.facility_hours || ""}
            onChange={(e) => update("facility_hours", e.target.value)}
            placeholder="Members have 24/7 access. Non-member bookings are available 10 AM – 8 PM."
            maxLength={500}
            rows={2}
            style={{ width: "100%", padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 4, fontSize: 13, background: "var(--surface)", color: "var(--text)", fontFamily: "inherit" }}
          />
        </div>
        <div className="mf" style={{ marginTop: 14, maxWidth: 280 }}>
          <label>Backup Access Code</label>
          <input
            type="text"
            value={branding.backup_access_code || ""}
            onChange={(e) => update("backup_access_code", e.target.value)}
            placeholder="e.g. 2138"
            maxLength={20}
            style={{ width: "100%", padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 4, fontFamily: "var(--font-mono)", fontSize: 13, background: "var(--surface)", color: "var(--text)" }}
          />
          <div className="muted" style={{ marginTop: 4 }}>
            Only relevant when Access Codes is enabled. Shown to members as a fallback in the troubleshooting flow if their Seam code fails. Leave blank if you don&rsquo;t have one.
          </div>
        </div>
      </div>

      {/* Operations — multi-tenant policy + naming. Each field falls
          back to a platform default when blank so a tenant who hasn't
          customized still gets sensible behavior. */}
      <div>
        <h4 style={{ fontFamily: "var(--font-display)", fontSize: 12, textTransform: "uppercase", letterSpacing: 1.5, color: "var(--text-muted)", marginBottom: 10 }}>
          Operations
        </h4>
        <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 14 }}>
          What members see and how the booking flow behaves. Leave a field blank to use the platform default.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div className="mf">
            <label>{(branding.bay_label_singular || "Bay")} list</label>
            <input
              type="text"
              value={Array.isArray(branding.bays) ? branding.bays.join(", ") : (branding.bays || "")}
              onChange={(e) => {
                const parts = e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean);
                update("bays", parts.length > 0 ? parts : null);
              }}
              placeholder="Bay 1, Bay 2"
              style={{ width: "100%", padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 4, fontSize: 13, background: "var(--surface)", color: "var(--text)" }}
            />
            <div className="muted" style={{ marginTop: 4 }}>
              Comma-separated list of bookable resources. Drives the booking grid + admin Today/Week views.
            </div>
          </div>

          <div className="mf">
            <label>Resource noun (singular)</label>
            <input
              type="text"
              value={branding.bay_label_singular || ""}
              onChange={(e) => update("bay_label_singular", e.target.value)}
              placeholder="Bay"
              maxLength={30}
              style={{ width: "100%", padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 4, fontSize: 13, background: "var(--surface)", color: "var(--text)" }}
            />
            <div className="muted" style={{ marginTop: 4 }}>
              "Bay", "Court", "Sim", "Lane". Used in copy across member + admin surfaces.
            </div>
          </div>

          <div className="mf">
            <label>Cancel cutoff (hours)</label>
            <input
              type="number"
              min="0"
              max="168"
              step="0.5"
              value={branding.cancel_cutoff_hours == null ? "" : branding.cancel_cutoff_hours}
              onChange={(e) => {
                const v = e.target.value;
                update("cancel_cutoff_hours", v === "" ? null : Number(v));
              }}
              placeholder="6"
              style={{ width: "100%", padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 4, fontSize: 13, background: "var(--surface)", color: "var(--text)" }}
            />
            <div className="muted" style={{ marginTop: 4 }}>
              How far in advance members can self-cancel. Server + UI + email copy all read this. Blank = platform default (6).
            </div>
          </div>

          <div className="mf">
            <label>Facility address</label>
            <input
              type="text"
              value={branding.facility_address || ""}
              onChange={(e) => update("facility_address", e.target.value)}
              placeholder="101 Main St, Portland, OR"
              maxLength={300}
              style={{ width: "100%", padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 4, fontSize: 13, background: "var(--surface)", color: "var(--text)" }}
            />
            <div className="muted" style={{ marginTop: 4 }}>
              Calendar invite location on booking confirmation emails. Members tap → directions.
            </div>
          </div>
        </div>

        <div className="mf" style={{ marginTop: 14 }}>
          <label>Tier colors (advanced — JSON)</label>
          <textarea
            value={
              branding._tierColorsRaw !== undefined
                ? branding._tierColorsRaw
                : (branding.tier_colors ? JSON.stringify(branding.tier_colors, null, 2) : "")
            }
            onChange={(e) => update("_tierColorsRaw", e.target.value)}
            placeholder='{ "Patron": { "bg": "#D1DFCB", "text": "#35443B" } }'
            rows={6}
            style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 4, fontFamily: "var(--font-mono)", fontSize: 12, background: "var(--surface)", color: "var(--text)" }}
          />
          <div className="muted" style={{ marginTop: 4 }}>
            Per-tier badge styling. Object map: <code>{`{ "TierName": { "bg": "#hex", "text": "#hex" } }`}</code>. Blank → fallback to platform default palette.
          </div>
        </div>
      </div>

      {/* Save + status */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 8 }}>
        <button
          className="btn primary"
          onClick={handleSave}
          disabled={saving}
          style={{ padding: "10px 24px", fontSize: 13 }}
        >
          {saving ? "Saving…" : "Save branding."}
        </button>
        {status && <span style={{ color: "var(--primary)", fontSize: 12 }}>{status}</span>}
        {error && <span style={{ color: "var(--red)", fontSize: 12 }}>{error}</span>}
      </div>
    </div>
  );
}
