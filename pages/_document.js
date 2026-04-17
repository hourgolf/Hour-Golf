import Document, { Html, Head, Main, NextScript } from "next/document";
import {
  FALLBACK_BRANDING,
  loadBranding,
  tenantIdFromReq,
  buildRootCssVars,
  buildDisplayFontFace,
  buildBackgroundImageRule,
} from "../lib/branding";

// Escape helper: keep user-supplied branding values from breaking out of
// <style> or HTML attribute contexts. Tenant names and font names are the
// only values that could reasonably contain weird characters today.
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

class MyDocument extends Document {
  static async getInitialProps(ctx) {
    const initialProps = await Document.getInitialProps(ctx);
    let branding = FALLBACK_BRANDING;
    try {
      const tenantId = tenantIdFromReq(ctx.req);
      branding = await loadBranding(tenantId);
    } catch {
      // Never fail the page render because of a branding fetch error.
      branding = FALLBACK_BRANDING;
    }
    return { ...initialProps, branding };
  }

  render() {
    const branding = this.props.branding || FALLBACK_BRANDING;
    const cssVars = buildRootCssVars(branding);
    const fontFace = buildDisplayFontFace(branding);
    const bgRule = buildBackgroundImageRule(branding);
    const appName = branding.app_name || "Hour Golf";
    const themeColor = branding.pwa_theme_color || branding.primary_color;

    return (
      <Html lang="en">
        <Head>
          {/* PWA (dynamic) */}
          <link rel="manifest" href="/manifest.json" />
          <meta name="theme-color" content={escapeHtml(themeColor)} />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
          <meta name="apple-mobile-web-app-title" content={escapeHtml(appName)} />
          {/* Icons stay static for Phase 3A — per-tenant icon generation is
              a later phase. Tenant #2 gets Hour Golf's icons until we build
              an icon upload + resize pipeline. */}
          <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
          <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192x192.png" />
          <link rel="icon" type="image/png" sizes="512x512" href="/icons/icon-512x512.png" />

          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          {/* Display fallback + Monospace */}
          <link
            href="https://fonts.googleapis.com/css2?family=Bungee&family=DM+Mono:wght@400;500&family=Fira+Code:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500;700&family=Inconsolata:wght@400;500;700&family=JetBrains+Mono:wght@400;500;700&family=Roboto+Mono:wght@400;500;700&family=Source+Code+Pro:wght@400;500;700&family=Space+Mono:wght@400;700&display=swap"
            rel="stylesheet"
          />
          {/* Sans Serif */}
          <link
            href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Inter:wght@400;500;700&family=Manrope:wght@400;500;700&family=Outfit:wght@400;500;700&family=Plus+Jakarta+Sans:wght@400;500;700&family=Space+Grotesk:wght@400;500;700&family=Syne:wght@400;500;700&family=Work+Sans:wght@400;500;700&display=swap"
            rel="stylesheet"
          />
          {/* Serif */}
          <link
            href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;700&family=DM+Serif+Display&family=Fraunces:wght@400;500;700&family=Libre+Baskerville:wght@400;700&family=Lora:wght@400;500;700&family=Playfair+Display:wght@400;500;700&display=swap"
            rel="stylesheet"
          />

          {/*
            Tenant-specific styles. Injected LAST in <head> so the :root
            declaration here wins over the one in globals.css (same
            specificity, later source order). Also registers the tenant's
            custom display font if they uploaded one.

            Using dangerouslySetInnerHTML is required for <style> content
            in React. The values come from our DB via a trusted SSR path
            and are escaped anyway to keep them from breaking out.
          */}
          <style
            data-tenant-branding=""
            dangerouslySetInnerHTML={{ __html: `${cssVars}\n${fontFace}\n${bgRule}` }}
          />
          {/*
            Inject the branding object as a global for client components.
            This avoids a round-trip on mount (no flash of Hour Golf default
            when rendering tenant #2). Safe to expose: every value here is
            already visible on the page anyway (colors in CSS vars, logo
            URL in the <img> we're about to render, etc.).

            JSON.stringify + the replace below prevents `</script>` in any
            value from breaking out of the tag.
          */}
          <script
            dangerouslySetInnerHTML={{
              __html: `window.__TENANT_BRANDING__ = ${JSON.stringify(branding).replace(/</g, "\\u003c")};`,
            }}
          />
        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}

export default MyDocument;
