import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { usePlatformAuth } from "../../../hooks/usePlatformAuth";
import PlatformShell from "../../../components/platform/PlatformShell";

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function suggestSlug(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40);
}

export default function NewTenantPage() {
  const router = useRouter();
  const { apiKey } = usePlatformAuth();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugDirty, setSlugDirty] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  // Auto-populate slug from name until the user types directly into slug.
  useEffect(() => {
    if (!slugDirty) setSlug(suggestSlug(name));
  }, [name, slugDirty]);

  const slugValid = SLUG_PATTERN.test(slug) && slug.length >= 2 && slug.length <= 40;

  async function submit() {
    if (submitting || !name.trim() || !slugValid) return;
    setSubmitting(true);
    setErr("");
    try {
      const r = await fetch("/api/platform-tenant-create", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          admin_email: adminEmail.trim() || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        throw new Error(d.detail || d.error || "Create failed");
      }
      const search = d.admin_skip_reason
        ? `?admin_skip=${encodeURIComponent(d.admin_skip_reason)}`
        : "";
      router.replace(`/platform/tenants/${d.tenant.slug}${search}`);
    } catch (e) {
      setErr(e.message);
      setSubmitting(false);
    }
  }

  return (
    <PlatformShell
      activeNav="tenants"
      breadcrumbs={[
        { label: "Tenants", href: "/platform" },
        { label: "New" },
      ]}
      title="New tenant"
      subtitle="Creates the tenant with all features enabled, default branding, and no Stripe config."
    >
      <div className="p-card" style={{ maxWidth: 640 }}>
        <div className="p-card-body">
          <div className="p-stack">
            <div className="p-field">
              <label className="p-field-label" htmlFor="tenant-name">Tenant name</label>
              <input
                id="tenant-name"
                className="p-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Swing Studio"
                autoFocus
              />
              <div className="p-field-hint">
                Display name shown on the tenant&rsquo;s subdomain and in emails.
              </div>
            </div>

            <div className="p-field">
              <label className="p-field-label" htmlFor="tenant-slug">Subdomain slug</label>
              <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
                <input
                  id="tenant-slug"
                  className="p-input p-input--mono"
                  type="text"
                  value={slug}
                  onChange={(e) => { setSlug(e.target.value.toLowerCase()); setSlugDirty(true); }}
                  placeholder="swing-studio"
                  style={{
                    borderTopRightRadius: 0,
                    borderBottomRightRadius: 0,
                    borderRight: "none",
                  }}
                />
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "0 12px",
                    background: "var(--p-surface-alt)",
                    border: "1px solid var(--p-border)",
                    borderTopRightRadius: "var(--p-radius)",
                    borderBottomRightRadius: "var(--p-radius)",
                    color: "var(--p-text-muted)",
                    fontFamily: "var(--p-font-mono)",
                    fontSize: 12,
                  }}
                >
                  .ourlee.co
                </span>
              </div>
              <div className="p-field-hint">
                Lowercase letters, numbers, and hyphens only (2–40 chars).
                Auto-suggested from name until you edit it manually.
                {!slugValid && slug.length > 0 && (
                  <span style={{ color: "var(--p-danger-text)" }}> — invalid format</span>
                )}
              </div>
            </div>

            <div className="p-field">
              <label className="p-field-label" htmlFor="admin-email">
                Initial admin email <span className="p-muted" style={{ fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                id="admin-email"
                className="p-input"
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                placeholder="someone@example.com"
              />
              <div className="p-field-hint">
                If this email matches an existing auth user, they&rsquo;ll be linked as an
                admin of the new tenant. Otherwise leave blank — you can add admins later.
                This endpoint does NOT create new auth users.
              </div>
            </div>

            {err && <div className="p-msg p-msg--error">{err}</div>}
          </div>
        </div>
        <div className="p-card-footer">
          <Link href="/platform" className="p-btn">Cancel</Link>
          <button
            className="p-btn p-btn--primary"
            onClick={submit}
            disabled={submitting || !name.trim() || !slugValid}
          >
            {submitting ? "Creating…" : "Create tenant"}
          </button>
        </div>
      </div>
    </PlatformShell>
  );
}
