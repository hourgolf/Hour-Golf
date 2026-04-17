import { useEffect, useState } from "react";

// Tenant-level branding editor. Each field reflects a column on the
// tenant_branding row for the current tenant (resolved from subdomain via
// middleware). Changes persist to DB on Save; the in-memory branding
// cache is flushed server-side so edits are visible on next page load.
//
// Scope (matches the product decision recorded in the plan):
//   - 5 colors: primary, accent, danger, cream, text
//   - Logo upload (/logos/<tenantId>/...)
//   - Background image upload (/logos/<tenantId>/... — same bucket)
//   - Display font: uploaded .woff2 OR Google Font name from curated list
//   - Body font: name from curated list
//
// What this intentionally does NOT do:
//   - Let admins pick arbitrary Google Fonts (curated list only)
//   - Edit other tenants' branding (super-admin job, future phase)
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

export default function TenantBranding({ apiKey }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [branding, setBranding] = useState(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingBg, setUploadingBg] = useState(false);
  const [uploadingFont, setUploadingFont] = useState(false);

  // Load the current tenant's branding once on mount.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch("/api/admin-tenant-branding", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const d = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) {
          setError(d.detail || d.error || `Load failed (${r.status})`);
        } else {
          setBranding(d);
        }
      } catch (e) {
        if (!cancelled) setError(e.message || "Failed to load branding");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [apiKey]);

  function update(key, value) {
    setBranding((b) => ({ ...b, [key]: value }));
    // Clear any stale status/error once the user starts editing again.
    setStatus("");
    setError("");
  }

  async function uploadAsset(file, endpoint, filenameBase, setUploading) {
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
      const r = await fetch(`${endpoint}?filename=${encodeURIComponent(name)}`, {
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

  async function handleLogoUpload(e) {
    const url = await uploadAsset(e.target.files?.[0], "/api/upload-logo", "logo", setUploadingLogo);
    if (url) update("logo_url", url);
  }

  async function handleBgUpload(e) {
    const url = await uploadAsset(e.target.files?.[0], "/api/upload-logo", "bg", setUploadingBg);
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
    const url = await uploadAsset(file, "/api/upload-font", "displayfont", setUploadingFont);
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
      payload.background_image_url = branding.background_image_url || null;
      payload.font_display_name = branding.font_display_name || null;
      payload.font_display_url = branding.font_display_url || null;
      payload.font_body_family = branding.font_body_family || null;

      const r = await fetch("/api/admin-tenant-branding", {
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

      {/* Assets */}
      <div>
        <h4 style={{ fontFamily: "var(--font-display)", fontSize: 12, textTransform: "uppercase", letterSpacing: 1.5, color: "var(--text-muted)", marginBottom: 10 }}>
          Assets
        </h4>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div className="mf">
            <label>Brand Logo (shown in header)</label>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              {branding.logo_url && (
                <div style={{ width: 80, height: 80, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--primary)", borderRadius: 6, padding: 8 }}>
                  <img src={branding.logo_url} alt="Logo" style={{ maxWidth: "100%", maxHeight: "100%", filter: "brightness(0) invert(0.95)" }} />
                </div>
              )}
              <input type="file" accept="image/*" onChange={handleLogoUpload} disabled={uploadingLogo} />
            </div>
            <input
              type="text"
              value={branding.logo_url || ""}
              onChange={(e) => update("logo_url", e.target.value)}
              placeholder="https://... or /path/to/logo.svg"
              style={{ width: "100%", padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 4, fontFamily: "var(--font-mono)", fontSize: 11, background: "var(--surface)", color: "var(--text)" }}
            />
            {uploadingLogo && <div className="muted" style={{ marginTop: 4 }}>Uploading…</div>}
          </div>

          <div className="mf">
            <label>Background Image (optional)</label>
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
