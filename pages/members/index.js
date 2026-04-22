import { useEffect } from "react";
import { useRouter } from "next/router";
import MemberLayout from "../../components/members/MemberLayout";

// Post-auth redirect. Default target is the member dashboard, but
// deep-link funnels from the public-facing pages can carry intent in
// the URL (or sessionStorage, to survive round-trips). We check in
// priority order:
//   1. ?tier=<slug> (from /join/<slug>) → POST /api/member-subscription
//      and redirect to Stripe Checkout so a fresh signup lands on
//      payment immediately.
//   2. ?from=book with bay/date/start → /members/book pre-selected.
//   3. (default) → /members/dashboard.
function RedirectToDashboard() {
  const router = useRouter();
  useEffect(() => {
    if (typeof window === "undefined") return;
    const qs = new URLSearchParams(window.location.search);

    // --- 1. Tier intent (from /join/<slug> funnel) ---
    // Accept either a URL param or sessionStorage stash set on the
    // join landing page. Slug is lowercased.
    let tierSlug = qs.get("tier") || null;
    if (!tierSlug) {
      try {
        const raw = sessionStorage.getItem("hg-intended-tier");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.tier && Date.now() - (parsed.stashedAt || 0) < 30 * 60 * 1000) {
            // Storage holds the display tier (e.g. "Patron"). Pass it
            // through as-is — the API accepts display-name tier.
            tierSlug = parsed.tier;
          } else {
            sessionStorage.removeItem("hg-intended-tier");
          }
        }
      } catch { /* non-fatal */ }
    }

    if (tierSlug) {
      (async () => {
        try {
          // Resolve slug → display-name tier via the public tiers
          // endpoint. Accept either slug form ("patron") or the raw
          // display name ("Patron") as input.
          const r = await fetch("/api/public-tiers");
          const { tiers = [] } = r.ok ? await r.json() : { tiers: [] };
          const slugify = (s) => String(s).toLowerCase().replace(/\s+/g, "-");
          const match = tiers.find((t) =>
            t.tier === tierSlug || slugify(t.tier) === slugify(tierSlug)
          );
          if (!match || Number(match.monthly_fee) <= 0) {
            // Bad slug — fall through to dashboard silently.
            router.replace("/members/dashboard");
            return;
          }
          const sub = await fetch("/api/member-subscription", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ tier: match.tier }),
          });
          const d = await sub.json();
          if (!sub.ok || !d.url) throw new Error(d.error || "Checkout setup failed");
          try { sessionStorage.removeItem("hg-intended-tier"); } catch { /* ignore */ }
          window.location.href = d.url;
        } catch (e) {
          console.warn("Tier auto-subscribe failed, falling back to dashboard:", e.message);
          router.replace("/members/dashboard");
        }
      })();
      return;
    }

    // --- 2. Book-funnel intent (pre-select a slot) ---
    if (
      qs.get("from") === "book" &&
      qs.get("bay") &&
      qs.get("date") &&
      qs.get("start")
    ) {
      const bay = qs.get("bay");
      const date = qs.get("date");
      const start = qs.get("start");
      try {
        sessionStorage.setItem(
          "hg-intended-slot",
          JSON.stringify({ bay, date, start, stashedAt: Date.now() })
        );
      } catch { /* private mode may throw; non-fatal */ }
      const forward = new URLSearchParams({ bay, date, start });
      router.replace(`/members/book?${forward.toString()}`);
      return;
    }

    // --- 3. Default ---
    router.replace("/members/dashboard");
  }, []);
  return <div className="mem-loading">Redirecting...</div>;
}

export default function MembersIndex() {
  return (
    <MemberLayout activeTab="dashboard">
      {() => <RedirectToDashboard />}
    </MemberLayout>
  );
}

// Per-request render so Vercel Edge CDN does not cache tenant branding.
// See lib/no-cache-ssr.js.
export { noCacheSSR as getServerSideProps } from "../../lib/no-cache-ssr";
