// Per-tier shortcut landing. A link like <portal>/join/patron or
// <portal>/join/green-jacket drops a prospective member straight into
// the Stripe subscribe checkout for that tier — via signup if they
// aren't logged in yet. Used on the tenant's Linktree and any social
// post that pitches a specific tier.
//
// Flow:
//   1. Resolve the tier slug against /api/public-tiers (tenant-scoped).
//      Slug = lowercase tier name with spaces as hyphens
//      ("Green Jacket" → "green-jacket"). We also accept a few common
//      marketing aliases (e.g. "player" for "Starter" per HG's Linktree).
//   2. Stash the intended tier in sessionStorage so it survives the
//      signup round-trip and any Stripe-side retries.
//   3. If a member session already exists → POST /api/member-subscription
//      and redirect to the returned Stripe Checkout URL.
//      Otherwise → redirect to /members?signup=1&tier=<slug> so the
//      signup form opens directly, and the post-auth redirect hands
//      off to the same subscribe-checkout step.

import { useEffect, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { useBranding } from "../../hooks/useBranding";

export { noCacheSSR as getServerSideProps } from "../../lib/no-cache-ssr";

function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

// Common marketing aliases — mostly for HG's "PLAYER" label on the
// Linktree that maps to the "Starter" tier in the DB. Add more as
// tenants adopt custom tier names.
const ALIASES = {
  player: "starter",
};

export default function JoinTierPage() {
  const router = useRouter();
  const branding = useBranding();
  const [message, setMessage] = useState("Getting things ready…");
  const [error, setError] = useState("");

  const primary = branding?.primary_color || "#4C8D73";
  const cream = branding?.cream_color || "#EDF3E3";
  const text = branding?.text_color || "#35443B";
  const appName = branding?.app_name || "the club";

  useEffect(() => {
    if (!router.isReady) return;
    let cancelled = false;

    async function run() {
      const raw = String(router.query.tier || "").trim().toLowerCase();
      const slug = ALIASES[raw] || raw;
      if (!slug) {
        setError("No tier specified.");
        return;
      }

      // Step 1: resolve the tier
      let tier = null;
      try {
        const r = await fetch("/api/public-tiers");
        if (!r.ok) throw new Error("Tier lookup failed.");
        const { tiers = [] } = await r.json();
        const match = tiers.find(
          (t) => slugify(t.tier) === slug && Number(t.monthly_fee) > 0
        );
        if (!match) {
          setError(`We don't have a "${raw}" membership option.`);
          return;
        }
        tier = match.tier;
      } catch (e) {
        if (!cancelled) setError(e.message || "Couldn't load tiers.");
        return;
      }

      if (cancelled) return;
      setMessage(`Setting up ${tier}…`);

      // Stash the intent so a billing/checkout round-trip can resume.
      try {
        sessionStorage.setItem(
          "hg-intended-tier",
          JSON.stringify({ tier, stashedAt: Date.now() })
        );
      } catch { /* non-fatal */ }

      // Step 2: branch on session
      let loggedIn = false;
      try {
        const s = await fetch("/api/member-session", { credentials: "include" });
        loggedIn = s.ok;
      } catch { loggedIn = false; }

      if (cancelled) return;

      if (!loggedIn) {
        // Signup with the tier carried along so post-auth lands on
        // Stripe Checkout automatically.
        router.replace(`/members?signup=1&tier=${encodeURIComponent(slug)}`);
        return;
      }

      // Already authenticated — skip signup, go straight to checkout.
      setMessage(`Redirecting to secure checkout…`);
      try {
        const r = await fetch("/api/member-subscription", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ tier }),
        });
        const d = await r.json();
        if (!r.ok || !d.url) throw new Error(d.error || "Checkout session could not be created.");
        // Let the browser navigate out — same-origin replace doesn't
        // work for external URLs.
        window.location.href = d.url;
      } catch (e) {
        if (!cancelled) setError(e.message || "Checkout failed.");
      }
    }

    run();
    return () => { cancelled = true; };
  }, [router.isReady, router.query.tier]);

  return (
    <>
      <Head>
        <title>Join {appName}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <main
        style={{
          minHeight: "100dvh",
          background: cream,
          color: text,
          fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            maxWidth: 420,
            width: "100%",
            background: "rgba(255,255,255,0.7)",
            borderRadius: 16,
            padding: "28px 24px",
            textAlign: "center",
          }}
        >
          {error ? (
            <>
              <h1 style={{ fontSize: 18, margin: "0 0 10px", fontFamily: "var(--font-display, inherit)" }}>
                We hit a snag.
              </h1>
              <p style={{ margin: "0 0 18px", fontSize: 14, color: `${text}bb`, lineHeight: 1.5 }}>{error}</p>
              <a
                href="/book"
                style={{
                  display: "inline-block",
                  padding: "12px 20px",
                  borderRadius: 12,
                  background: primary,
                  color: "#fff",
                  textDecoration: "none",
                  fontWeight: 700,
                  fontFamily: "var(--font-display, inherit)",
                }}
              >
                See membership options
              </a>
            </>
          ) : (
            <>
              <div
                aria-hidden="true"
                style={{
                  width: 40, height: 40, margin: "0 auto 14px",
                  borderRadius: "50%",
                  border: `3px solid ${primary}22`,
                  borderTopColor: primary,
                  animation: "spin 0.9s linear infinite",
                }}
              />
              <p style={{ margin: 0, fontSize: 14, color: `${text}cc` }}>{message}</p>
              <style jsx>{`
                @keyframes spin { to { transform: rotate(360deg); } }
              `}</style>
            </>
          )}
        </div>
      </main>
    </>
  );
}
