export const SUPABASE_URL = "https://uxpkqbioxoezjmcoylkw.supabase.co";

export const TIERS = ["Non-Member", "Patron", "Starter", "Green Jacket", "Unlimited"];

export const TIER_COLORS = {
  "Non-Member": "#78716c",
  Patron: "#4a7c59",
  Starter: "#2d6a9f",
  "Green Jacket": "#1a472a",
  Unlimited: "#a67c00",
};

export const BAYS = ["Bay 1", "Bay 2"];

export const TZ = "America/Los_Angeles";

export const THEMES = {
  augusta: { primary: "#1a472a", label: "Augusta Green" },
  midnight: { primary: "#1a1a2e", label: "Midnight" },
  navy: { primary: "#1b3a5c", label: "Navy" },
  slate: { primary: "#3d4451", label: "Slate" },
  rust: { primary: "#8b4513", label: "Rust" },
  noir: { primary: "#222", label: "Noir" },
};

// Fonts organized by category
export const FONT_CATEGORIES = {
  Monospace: {
    "'IBM Plex Mono', monospace": "IBM Plex Mono",
    "'JetBrains Mono', monospace": "JetBrains Mono",
    "'Space Mono', monospace": "Space Mono",
    "'Fira Code', monospace": "Fira Code",
    "'Source Code Pro', monospace": "Source Code Pro",
    "'Roboto Mono', monospace": "Roboto Mono",
    "'DM Mono', monospace": "DM Mono",
    "'Inconsolata', monospace": "Inconsolata",
  },
  "Sans Serif": {
    "'Inter', sans-serif": "Inter",
    "'DM Sans', sans-serif": "DM Sans",
    "'Work Sans', sans-serif": "Work Sans",
    "'Outfit', sans-serif": "Outfit",
    "'Plus Jakarta Sans', sans-serif": "Plus Jakarta Sans",
    "'Satoshi', sans-serif": "Satoshi",
    "'General Sans', sans-serif": "General Sans",
    "'Space Grotesk', sans-serif": "Space Grotesk",
    "'Syne', sans-serif": "Syne",
    "'Manrope', sans-serif": "Manrope",
  },
  Serif: {
    "'Playfair Display', serif": "Playfair Display",
    "'Lora', serif": "Lora",
    "'Fraunces', serif": "Fraunces",
    "'DM Serif Display', serif": "DM Serif Display",
    "'Cormorant Garamond', serif": "Cormorant Garamond",
    "'Libre Baskerville', serif": "Libre Baskerville",
  },
};

// Flat map for lookups
export const FONTS = Object.values(FONT_CATEGORIES).reduce((acc, cat) => ({ ...acc, ...cat }), {});
