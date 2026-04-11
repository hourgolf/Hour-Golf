import { useState, useRef } from "react";
import { SUPABASE_URL } from "../../lib/constants";

export default function LogoUpload({ settings, updateSetting, apiKey }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef(null);

  async function handleUpload(file) {
    if (!file || !apiKey) return;
    setUploading(true);
    setError("");
    try {
      const ext = file.name.split(".").pop();
      const filename = `logo_${Date.now()}.${ext}`;

      const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/logos/${filename}`, {
        method: "POST",
        headers: {
          apikey: apiKey,
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": file.type,
          "x-upsert": "true",
        },
        body: file,
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text);
      }

      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/logos/${filename}`;
      updateSetting("logoUrl", publicUrl);
    } catch (e) {
      setError(e.message || "Upload failed");
    }
    setUploading(false);
  }

  function handleRemove() {
    updateSetting("logoUrl", "");
  }

  return (
    <div className="mf">
      <label>Logo</label>
      <div
        className="logo-upload-area"
        onClick={() => fileRef.current?.click()}
      >
        {settings.logoUrl ? (
          <img src={settings.logoUrl} alt="Logo" style={{ maxHeight: settings.logoScale || 36 }} />
        ) : (
          <span className="muted">Click to upload logo</span>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => handleUpload(e.target.files[0])}
        />
      </div>
      {uploading && <div className="muted" style={{ marginTop: 4 }}>Uploading...</div>}
      {error && <div style={{ color: "var(--red)", fontSize: 11, marginTop: 4 }}>{error}</div>}
      {settings.logoUrl && (
        <>
          <div style={{ marginTop: 10 }}>
            <label style={{ display: "block", fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 5 }}>
              Logo Size &mdash; {settings.logoScale || 36}px
            </label>
            <input
              type="range"
              min={16}
              max={80}
              step={2}
              value={settings.logoScale || 36}
              onChange={(e) => updateSetting("logoScale", Number(e.target.value))}
              style={{ width: "100%", accentColor: "var(--primary)" }}
            />
          </div>
          <button className="btn danger" style={{ marginTop: 8, fontSize: 10 }} onClick={handleRemove}>
            Remove Logo
          </button>
        </>
      )}
    </div>
  );
}
