// Public-facing "how to install the member app" explainer page. Linkable,
// brandable, mobile-first. This is the URL that goes under physical QR
// codes in the clubhouse + bays, and the CTA in the launch broadcast
// email. Must render without auth.
//
// Tenant-branded: colors + app name + support contact come from the
// branding payload injected by _document.js, so Hour Golf gets Hour
// Golf's look and any future tenant gets theirs.

import { useEffect, useState } from "react";
import Head from "next/head";
import { useBranding } from "../hooks/useBranding";

export { noCacheSSR as getServerSideProps } from "../lib/no-cache-ssr";

// iOS / Android detection for the platform-specific instructions. We
// only use this to choose which card to OPEN by default — both cards
// are always visible so a member on desktop sending themselves a link
// can preview both.
function detectPlatform() {
  if (typeof window === "undefined") return "unknown";
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

export default function AppInstallPage() {
  const branding = useBranding();
  const [platform, setPlatform] = useState("unknown");

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  const appName = branding?.app_name || "the member app";
  const primary = branding?.primary_color || "#4C8D73";
  const cream = branding?.cream_color || "#EDF3E3";
  const text = branding?.text_color || "#35443B";
  const logoUrl =
    branding?.welcome_logo_url ||
    branding?.header_logo_url ||
    branding?.logo_url ||
    null;
  const supportEmail = branding?.support_email || null;
  const supportPhone = branding?.support_phone || null;

  return (
    <>
      <Head>
        <title>Get {appName} on your phone</title>
        <meta
          name="description"
          content={`The new ${appName} member app — book bays, access codes, pro shop, and more. Three-step install.`}
        />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>

      <main
        style={{
          minHeight: "100dvh",
          background: cream,
          color: text,
          fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
          paddingBottom: 40,
        }}
      >
        {/* Hero */}
        <section
          style={{
            background: primary,
            color: "#fff",
            padding: "40px 24px 48px",
            textAlign: "center",
          }}
        >
          {logoUrl && (
            <img
              src={logoUrl}
              alt={appName}
              style={{
                maxHeight: 80,
                maxWidth: "min(70vw, 320px)",
                marginBottom: 22,
                filter: "brightness(0) invert(1)",
              }}
            />
          )}
          <div
            style={{
              display: "inline-block",
              padding: "4px 12px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.15)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: "uppercase",
              marginBottom: 12,
            }}
          >
            New
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: "clamp(26px, 6vw, 40px)",
              fontFamily: "var(--font-display, inherit)",
              lineHeight: 1.15,
              fontWeight: 700,
            }}
          >
            The {appName} app is here.
          </h1>
          <p
            style={{
              margin: "14px auto 0",
              maxWidth: 520,
              fontSize: 16,
              lineHeight: 1.5,
              opacity: 0.92,
            }}
          >
            Book bays, see your live door code, shop the pro shop, and manage
            your membership — all from your phone. Three steps to set it up.
          </p>
        </section>

        {/* Three-step onboarding */}
        <section
          style={{
            maxWidth: 640,
            margin: "0 auto",
            padding: "32px 22px 8px",
          }}
        >
          <h2
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 1.4,
              textTransform: "uppercase",
              color: primary,
              margin: "0 0 14px",
            }}
          >
            Getting started
          </h2>

          <Step
            n={1}
            title="Open this site on your phone"
            body={
              <>
                If you're reading this on your laptop, scan the QR code on the
                clubhouse card, or text yourself this link. The app lives in
                your browser — no App Store download needed.
              </>
            }
            primary={primary}
          />

          <Step
            n={2}
            title="Sign in with your email"
            body={
              <>
                Use the email address {appName} already has on file (the one
                we send receipts to). First time in?{" "}
                <strong>Tap "Forgot password"</strong> — you'll get a reset
                link in seconds. New members can tap{" "}
                <strong>Create account</strong>.
              </>
            }
            primary={primary}
            cta={{ label: "Sign in", href: "/members" }}
          />

          <Step
            n={3}
            title="Add it to your home screen"
            body={
              <>
                This makes the app feel and launch like a native app — full
                screen, one-tap open. See instructions below for your phone.
              </>
            }
            primary={primary}
          />
        </section>

        {/* Platform-specific install cards */}
        <section style={{ maxWidth: 640, margin: "0 auto", padding: "8px 22px" }}>
          <InstallCard
            title="On iPhone / iPad (Safari)"
            steps={[
              <>Make sure this page is open in <strong>Safari</strong> (not Chrome or in-app browser — the install option is a Safari-only feature).</>,
              <>Tap the <strong>Share</strong> button (the square with an up-arrow) at the bottom of the screen.</>,
              <>Scroll down and tap <strong>Add to Home Screen</strong>.</>,
              <>Confirm the name, tap <strong>Add</strong>. Done.</>,
            ]}
            defaultOpen={platform === "ios"}
            primary={primary}
          />
          <InstallCard
            title="On Android (Chrome)"
            steps={[
              <>Open this page in <strong>Chrome</strong>.</>,
              <>Tap the <strong>⋮ menu</strong> in the top-right corner.</>,
              <>Tap <strong>Install app</strong> (or <strong>Add to Home screen</strong> on older Chrome).</>,
              <>Confirm, and the icon lands on your home screen.</>,
            ]}
            defaultOpen={platform === "android"}
            primary={primary}
          />
          <InstallCard
            title="On Desktop (Chrome / Edge)"
            steps={[
              <>Look for the small <strong>install icon</strong> in the right side of the address bar (a monitor with a down-arrow).</>,
              <>Click it, then <strong>Install</strong>. The app opens in its own window.</>,
              <>Optional — desktop works fine in a regular browser tab if you don't want to install.</>,
            ]}
            defaultOpen={platform === "desktop"}
            primary={primary}
          />
        </section>

        {/* What you can do */}
        <section style={{ maxWidth: 640, margin: "0 auto", padding: "22px 22px 8px" }}>
          <h2
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 1.4,
              textTransform: "uppercase",
              color: primary,
              margin: "0 0 14px",
            }}
          >
            What you can do
          </h2>
          <Feature icon="📅" title="Book bays" body="Live availability, 7 days out, tap to book." primary={primary} />
          <Feature icon="🔑" title="Live door code" body="Your access code appears on your dashboard 10 minutes before your session." primary={primary} />
          <Feature icon="🛍️" title="Pro shop" body="Browse inventory, buy on your card, pick up next visit." primary={primary} />
          <Feature icon="⭐" title="Membership control" body="Upgrade, downgrade, or cancel your plan anytime." primary={primary} />
        </section>

        {/* Primary CTA */}
        <section style={{ maxWidth: 480, margin: "24px auto 0", padding: "0 22px" }}>
          <a
            href="/members"
            style={{
              display: "block",
              width: "100%",
              padding: "16px 22px",
              background: primary,
              color: "#fff",
              borderRadius: 14,
              textAlign: "center",
              textDecoration: "none",
              fontWeight: 700,
              fontSize: 16,
              letterSpacing: 0.3,
              fontFamily: "var(--font-display, inherit)",
              boxSizing: "border-box",
            }}
          >
            Open the app →
          </a>
          <p style={{ fontSize: 12, color: text, opacity: 0.7, textAlign: "center", marginTop: 10 }}>
            You can always revisit this page at <strong>{appName}/app</strong>.
          </p>
        </section>

        {/* Support footer */}
        {(supportEmail || supportPhone) && (
          <section
            style={{
              maxWidth: 640,
              margin: "28px auto 0",
              padding: "20px 22px",
              borderTop: `1px solid ${text}22`,
              textAlign: "center",
              fontSize: 13,
              color: text,
              opacity: 0.75,
            }}
          >
            Questions? We're here:
            {supportEmail && (
              <> <a href={`mailto:${supportEmail}`} style={{ color: primary, fontWeight: 600 }}>{supportEmail}</a></>
            )}
            {supportEmail && supportPhone && " · "}
            {supportPhone && (
              <a href={`tel:${supportPhone.replace(/\s+/g, "")}`} style={{ color: primary, fontWeight: 600 }}>{supportPhone}</a>
            )}
          </section>
        )}
      </main>
    </>
  );
}

function Step({ n, title, body, primary, cta }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.6)",
        borderRadius: 14,
        padding: "16px 18px",
        marginBottom: 12,
        display: "flex",
        gap: 14,
        alignItems: "flex-start",
      }}
    >
      <div
        style={{
          flexShrink: 0,
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: primary,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          fontSize: 15,
          fontFamily: "var(--font-display, inherit)",
        }}
      >
        {n}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 style={{ margin: "0 0 6px", fontSize: 16, fontFamily: "var(--font-display, inherit)" }}>{title}</h3>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>{body}</p>
        {cta && (
          <a
            href={cta.href}
            style={{
              display: "inline-block",
              marginTop: 10,
              padding: "8px 16px",
              background: primary,
              color: "#fff",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            {cta.label}
          </a>
        )}
      </div>
    </div>
  );
}

function InstallCard({ title, steps, defaultOpen, primary }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { setOpen(defaultOpen); }, [defaultOpen]);

  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      style={{
        background: "rgba(255,255,255,0.6)",
        borderRadius: 14,
        marginBottom: 10,
        overflow: "hidden",
      }}
    >
      <summary
        style={{
          padding: "14px 18px",
          fontWeight: 600,
          fontSize: 15,
          cursor: "pointer",
          listStyle: "none",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontFamily: "var(--font-display, inherit)",
        }}
      >
        {title}
        <span style={{ fontSize: 18, color: primary }}>{open ? "−" : "+"}</span>
      </summary>
      <ol
        style={{
          margin: 0,
          padding: "0 22px 16px 40px",
          fontSize: 14,
          lineHeight: 1.6,
        }}
      >
        {steps.map((s, i) => (
          <li key={i} style={{ marginBottom: 6 }}>{s}</li>
        ))}
      </ol>
    </details>
  );
}

function Feature({ icon, title, body, primary }) {
  return (
    <div style={{ display: "flex", gap: 14, padding: "12px 0", alignItems: "flex-start" }}>
      <div
        style={{
          flexShrink: 0,
          width: 40,
          height: 40,
          borderRadius: 10,
          background: `${primary}18`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 20,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 style={{ margin: "0 0 2px", fontSize: 15, fontFamily: "var(--font-display, inherit)" }}>{title}</h3>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{body}</p>
      </div>
    </div>
  );
}
