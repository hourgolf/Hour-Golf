import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en">
      <Head>
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
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
