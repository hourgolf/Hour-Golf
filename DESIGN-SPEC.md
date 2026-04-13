# Hour Golf — Dashboard & Member Portal Design Conversion Spec

## Context

Hour Golf has a new website under development with a distinctive, handmade visual identity. The admin dashboard and member portal (both Next.js apps on Vercel) need a cosmetic overhaul to feel like seamless extensions of that website — same colors, same typography, same "record store of golf" energy — while preserving all existing functionality.

**This is a cosmetic conversion, not a rebuild.** All business logic, API routes, Supabase queries, Stripe integration, and component architecture stay exactly as they are. We are reskinning the UI layer only.

---

## Brand Identity

Hour Golf positions itself as "the record store of golf in Portland" — indie, curated, nerdy about the craft, welcoming, not corporate. The website has an organic, collage-inspired aesthetic with hand-drawn blob shapes, watercolor accents, and bold poster typography. The dashboard should feel like the back office of that same space — same paint on the walls, same typeface on the signage, but organized for work.

---

## Color Palette (from brand spec sheet — use these exact values)

| Name | Hex | CSS Variable | Usage |
|------|-----|-------------|-------|
| Pale Green | `#EDF3E3` | `--bg` | Page background, card fills |
| Light Green | `#D1DFCB` | `--border`, `--hover` | Borders, hover states, subtle fills, row alternation |
| Medium Green | `#8BB5A0` | `--muted`, `--accent` | Section backgrounds, muted text, nav backgrounds, CTA banners |
| Dark Green | `#4C8D73` | `--primary` | Primary buttons, active states, emphasis, table headers |
| Red | `#C92F1F` | `--red` | CTA buttons ("BOOK NOW."), alerts, overages, unpaid badges |
| Black Green | `#35443B` | `--text` | Primary text, headings, icons |
| White | `#FFFFFF` | `--surface` | Card surfaces, input backgrounds, modals |

### Tier Badge Colors
| Tier | Background | Text |
|------|-----------|------|
| Non-Member | `#D1DFCB` | `#35443B` |
| Patron | `#D1DFCB` | `#35443B` |
| Starter | `#8BB5A0` | `#EDF3E3` |
| Green Jacket | `#4C8D73` | `#EDF3E3` |
| Unlimited | `#35443B` | `#D1DFCB` |

### Status Colors
- Overage / Unpaid / Error: `#C92F1F` (red) with `rgba(201,47,31,0.07)` background
- Success / Paid: `#4C8D73` (dark green) with `rgba(76,141,115,0.1)` background
- Neutral / Pending: `#8BB5A0` (medium green)

---

## Typography

### Font Stack (3 fonts only)

**Display / Headings: Biden Bold**
- File: `/public/fonts/biden-bold.woff2` (self-hosted, loaded via @font-face in globals.css)
- CSS: `font-family: 'Biden Bold', 'Bungee', sans-serif;` (Bungee is the Google Fonts fallback)
- Used for: Page titles, section headers, stat numbers, button text, tier badges, nav brand name
- Style: All text rendered in this font should feel bold and poster-like
- Convention: Button labels always end with a period followed by trailing space: `"BOOK NOW.    "`

**Body / UI: Aghast Regular (substitute: DM Sans)**
- Google Fonts: `DM Sans` at weights 400, 500, 600
- CSS: `font-family: 'DM Sans', sans-serif;`
- Letter-spacing: `0.03em` on all body text (approximates Aghast's +50 tracking)
- Used for: Body copy, table cell text, form labels (when not monospace), descriptions, member names

**Data / Monospace: IBM Plex Mono**
- Google Fonts: `IBM Plex Mono` at weights 400, 500
- CSS: `font-family: 'IBM Plex Mono', monospace;`
- Used for: Numbers (hours, dollars, percentages), timestamps, booking IDs, data table values, section sublabels
- Style: `font-size: 10-12px; text-transform: uppercase; letter-spacing: 0.08-0.1em` for labels

### Type Scale
| Element | Font | Size | Weight | Notes |
|---------|------|------|--------|-------|
| Page title (H1) | Biden Bold | 28-32px | 700 | e.g. "Hey, Matt." |
| Section header (H2) | Biden Bold | 16-20px | 700 | e.g. "Next up." "Recent sessions." |
| Subsection / table header | Biden Bold | 12-14px | 700 | e.g. availability grid headers |
| Body text | DM Sans | 14-15px | 400 | Member names, descriptions |
| Body emphasis | DM Sans | 14-15px | 600 | Active nav, bold names |
| Data values | IBM Plex Mono | 12-13px | 400 | "4.5h", "$97.50", "2:00 PM" |
| Labels / captions | IBM Plex Mono | 10-11px | 500 | "MEMBER HOURS", "OVERAGE DUE" — uppercase, wide tracking |
| Stat card number | Biden Bold | 28-36px | 700 | Large display number |

---

## Spacing & Shape

- **Border radius: 15px sitewide.** Every card, button, input, badge, modal, dropdown uses `border-radius: 15px`. This is from the brand spec. No exceptions.
- **Card borders:** `0.5px solid #D1DFCB` (light green). No shadows except on modals.
- **Inputs:** `1.5px solid #D1DFCB` border, white background, 15px radius. Focus state: `border-color: #4C8D73; box-shadow: 0 0 0 3px #D1DFCB`.
- **Row padding:** 12-14px vertical, 16-20px horizontal.
- **Section spacing:** 24-32px between major sections.
- **Button padding:** 12px 28px for primary, 5-6px 12px for compact/ghost.

---

## Component-by-Component Conversion Guide

### Global: `styles/globals.css`

Replace the existing CSS variables block with the brand palette above. Update the `@font-face` declaration for Biden Bold. Load Google Fonts for DM Sans and IBM Plex Mono in `_app.js` or `_document.js`.

Old variables to replace:
```
--primary: #1a472a  →  --primary: #4C8D73
--bg: #f5f3ef       →  --bg: #EDF3E3
--surface: #fff     →  --surface: #FFFFFF
--border: #e0ddd6   →  --border: #D1DFCB
--text: #2a2a2a     →  --text: #35443B
--text-muted: #888  →  --text-muted: #8BB5A0
--red: #cc4455      →  --red: #C92F1F
--gold: #a67c00     →  (remove, not in brand palette)
--font: 'IBM Plex Mono'  →  --font-display: 'Biden Bold', 'Bungee', sans-serif
                            --font-body: 'DM Sans', sans-serif
                            --font-mono: 'IBM Plex Mono', monospace
--radius: 8px       →  --radius: 15px
```

### Header: `components/layout/Header.js`

- Background: `#FFFFFF` with `0.5px solid #D1DFCB` bottom border
- Brand name "HOUR GOLF" in Biden Bold, 20px, color `#35443B`
- Stats in header (TODAY count, BAY HRS, MEMBERS) use Biden Bold for numbers, IBM Plex Mono for labels
- Buttons: "+ Booking" gets `background: #4C8D73; color: #EDF3E3; border-radius: 15px; font-family: Biden Bold`
- Settings gear icon inherits `#35443B`

### Nav: `components/layout/Nav.js`

- Tab buttons: `border-radius: 15px`
- Active tab: `background: #EDF3E3; color: #35443B; font-weight: 600`
- Inactive tabs: `color: #8BB5A0`
- Font: DM Sans 13px

### Badge: `components/ui/Badge.js`

- Shape: `border-radius: 15px; padding: 3px 12px`
- Font: Biden Bold, 11px, uppercase, `letter-spacing: 0.04em`
- Colors: per tier table above
- UNPAID badge: `background: #C92F1F; color: rgba(237,243,227,0.85)`

### Buttons (all)

- `border-radius: 15px`
- Font: Biden Bold, 14px, uppercase
- Period convention: all labels end with `. ` (period + thin space)
- Primary (green): `bg: #4C8D73; color: #EDF3E3`
- CTA (red): `bg: #C92F1F; color: rgba(237,243,227,0.85)` — used for "BOOK NOW." and "CHARGE."
- Ghost: `bg: transparent; border: 1px solid rgba(53,68,59,0.25); color: #35443B`
- Hover: `transform: scale(0.97)` on press
- Disabled: `opacity: 0.5; cursor: not-allowed`

### Inputs & Selects

- `border: 1.5px solid #D1DFCB; border-radius: 15px; background: #FFFFFF`
- Font: DM Sans 15px, `letter-spacing: 0.03em`
- Label above: IBM Plex Mono 10px, uppercase, `letter-spacing: 0.1em; color: #4C8D73`
- Focus: `border-color: #4C8D73; box-shadow: 0 0 0 3px #D1DFCB`

### Cards (stat cards, booking cards, profile sections)

- `background: #FFFFFF; border: 0.5px solid #D1DFCB; border-radius: 15px`
- Stat label: IBM Plex Mono 10px, uppercase, `color: #8BB5A0`
- Stat number: Biden Bold 28-36px, `color: #35443B`

### Tables (usage, calendar, availability)

- Table header row: `background: #4C8D73; color: #EDF3E3; font-family: Biden Bold; font-size: 12px`
- Alternating rows: white / `#EDF3E3`
- Row borders: `0.5px solid #D1DFCB`
- Data cells: IBM Plex Mono 12px
- Name cells: DM Sans 13-14px

### Modals (booking form, settings, confirm dialogs)

- Backdrop: `rgba(53,68,59,0.4)`
- Modal: `background: #FFFFFF; border-radius: 15px; padding: 28-32px`
- Title: Biden Bold 20px
- Close/Cancel: ghost button
- Confirm: green or red primary button

### Reports Page

- Chart bars: use `#4C8D73` (dark green) as primary bar color
- Heatmap cells: gradient from `#EDF3E3` (lightest) → `#D1DFCB` → `#8BB5A0` → `#4C8D73` → `#35443B` (darkest)
- Chart labels: IBM Plex Mono 11px

### Settings Panel: `components/settings/SettingsPanel.js`

- Update theme presets to use brand palette
- Default accent: `#4C8D73` instead of `#1a472a`
- Keep font selector but default to the brand stack
- Keep density/dark mode toggles

---

## Member Portal (separate surface, same brand)

The member portal lives at `/members/*` routes and is the customer-facing booking interface. It should feel warmer and more welcoming than the admin dashboard, while using the exact same brand system.

### Key differences from admin:
- Organic blob shapes as subtle background decoration (SVG paths, positioned absolute, ~20-30% opacity)
- A faint watercolor-blue accent blob (color `#A8D5E2` at ~18% opacity) as visual variety
- More generous spacing and larger touch targets (mobile-first)
- No data density — one thing at a time, clear primary action

### Member Portal Screens:

**Login:** White card on pale green background with blob shapes. "WELCOME BACK." header in Biden Bold. Green "SIGN IN." button. Friendly error: "Hmm, that didn't work."

**Sign-up:** "JOIN THE CLUB." header. Fields: name, email, phone, DOB, password, confirm. Terms checkbox. Green "CREATE ACCOUNT." button.

**Dashboard (post-login):** Greeting "Hey, Matt." in Biden Bold. Three stat cards (usage bar, upcoming count, membership tier). Next upcoming booking with cancel button. Green "READY TO PLAY?" CTA banner with red "BOOK NOW." button. Recent sessions list.

**Book a Bay:** Date/bay/time pickers. Availability grid with color-coded open (green text) / booked (red text, faint red background) slots. Terms checkbox. Green "CONFIRM BOOKING." button.

**Billing:** Upcoming — shows any overage charges, payment history.

**Account:** Profile info (read-only name, email, phone), tier display, notification toggles.

---

## Blob Shape Reference (for member portal backgrounds)

Use SVG paths positioned absolutely behind content. Two shapes:

**Fairway blob (green, organic):**
```html
<svg viewBox="0 0 600 500" style="position:absolute;pointer-events:none">
  <path d="M420,50C520,80 570,180 550,300C530,420 440,470 320,460C200,450 100,400 60,300C20,200 60,100 160,60C260,20 320,20 420,50Z" fill="#8BB5A0" opacity="0.3"/>
</svg>
```

**Watercolor accent (blue):**
```html
<svg viewBox="0 0 400 400" style="position:absolute;pointer-events:none">
  <ellipse cx="200" cy="200" rx="180" ry="150" fill="#A8D5E2" opacity="0.18"/>
</svg>
```

Place 2-3 of these per page at various positions (top-right, bottom-left, etc.) with rotation variations. They should never obstruct content. Admin dashboard does NOT use these — admin is clean and functional.

---

## Animation

Keep it minimal and functional:
- Page/tab transitions: `opacity 0→1, translateY 14px→0` over 350ms ease
- Button press: `transform: scale(0.97)` for 120ms
- Focus rings: `box-shadow: 0 0 0 3px #D1DFCB` transition 200ms
- Usage bar fill: `width transition 600ms ease`
- No bounce, no spring, no parallax

---

## What NOT to Change

- Any Supabase query logic
- Any Stripe API route
- Any data transformation or business logic
- The component file structure (unless adding new files)
- The Pages Router architecture
- Keyboard shortcuts
- Auto-refresh behavior
- Timezone handling

---

## Priority Order

1. **`styles/globals.css`** — Update all CSS variables to brand palette. Add @font-face for Biden Bold. This alone will cascade across most of the app.
2. **Badge.js** — Update tier colors and shape (15px radius, Biden Bold)
3. **Header.js + Nav.js** — Brand name, button styles, tab styles
4. **All buttons** — 15px radius, Biden Bold, period convention
5. **All inputs** — 15px radius, brand border colors, focus states
6. **Table headers** — Dark green background, Biden Bold
7. **Cards/stat displays** — Brand colors, correct type hierarchy
8. **Reports charts** — Brand color ramp for bars and heatmap
9. **Settings defaults** — Default theme to brand palette
10. **Member portal pages** — Apply full brand treatment with blob shapes

---

## Testing Checklist

After the conversion, verify:
- [ ] All text is legible against its background
- [ ] Tier badges use correct colors per tier
- [ ] Buttons have 15px radius and period convention
- [ ] Inputs have brand focus states
- [ ] Tables alternate pale green / white rows
- [ ] Header shows "HOUR GOLF" in Biden Bold
- [ ] Stat numbers use Biden Bold
- [ ] Data values (hours, dollars) use IBM Plex Mono
- [ ] Member names use DM Sans
- [ ] No old color values (#1a472a, #f5f3ef, #e0ddd6, #a67c00) remain
- [ ] Dark mode still works (adjust dark palette to brand if needed)
- [ ] All existing functionality unchanged
