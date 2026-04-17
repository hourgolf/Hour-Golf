import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import Head from "next/head";
import { usePlatformAuth } from "../../../hooks/usePlatformAuth";

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
  const { apiKey, connected, authLoading } = usePlatformAuth();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugDirty, setSlugDirty] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!authLoading && !connected) router.replace("/platform/login");
  }, [connected, authLoading, router]);

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
      // Redirect to the new tenant's detail page. The admin_skip_reason
      // is surfaced in a query param so the detail page can optionally
      // show a toast if the admin link was skipped.
      const search = d.admin_skip_reason
        ? `?admin_skip=${encodeURIComponent(d.admin_skip_reason)}`
        : "";
      router.replace(`/platform/tenants/${d.tenant.slug}${search}`);
    } catch (e) {
      setErr(e.message);
      setSubmitting(false);
    }
  }

  if (authLoading || !connected) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>;
  }

  return (
    <>
      <Head><title>New Tenant — Ourlee Platform</title></Head>
      <div style={{ maxWidth: 600, margin: "0 auto", padding: "32px 20px" }}>
        <Link href="/platform" style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: 1 }}>
          ← All tenants
        </Link>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: "16px 0 24px" }}>New tenant</h1>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="mf">
            <label>Tenant name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Swing Studio"
              autoFocus
            />
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              Display name shown on the tenant&rsquo;s subdomain and in emails.
            </div>
          </div>

          <div className="mf">
            <label>Subdomain slug</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="text"
                value={slug}
                onChange={(e) => { setSlug(e.target.value.toLowerCase()); setSlugDirty(true); }}
                placeholder="swing-studio"
                style={{ flex: 1, fontFamily: "var(--font-mono)" }}
              />
              <span style={{ color: "var(--text-muted)", fontSize: 13 }}>.ourlee.co</span>
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              Lowercase letters, numbers, and hyphens only (2–40 chars).
              Auto-suggested from name; click to edit manually.
              {!slugValid && slug.length > 0 && (
                <span style={{ color: "var(--red)" }}> — invalid format</span>
              )}
            </div>
          </div>

          <div className="mf">
            <label>Initial admin email <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label>
            <input
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="someone@example.com"
            />
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              If this email matches an existing auth user, they&rsquo;ll be linked as an
              admin of the new tenant. Otherwise leave blank — you can add admins later.
              This endpoint does NOT create new auth users.
            </div>
          </div>

          <div style={{ background: "#f6f7f4", padding: 14, borderRadius: 8, fontSize: 12, color: "var(--text-muted)" }}>
            Creates the tenant with all 8 features enabled, platform-default branding,
            and no Stripe config. You can adjust each in the tenant&rsquo;s detail page
            after it&rsquo;s created.
          </div>

          {err && <p className="err">{err}</p>}

          <div style={{ display: "flex", gap: 12 }}>
            <button
              className="btn primary"
              onClick={submit}
              disabled={submitting || !name.trim() || !slugValid}
              style={{ padding: "10px 24px", fontSize: 13 }}
            >
              {submitting ? "Creating…" : "Create tenant."}
            </button>
            <Link
              href="/platform"
              style={{ padding: "10px 24px", fontSize: 13, color: "var(--text-muted)", alignSelf: "center" }}
            >
              Cancel
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
