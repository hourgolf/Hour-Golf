# Email template handoff — designer workflow

Short version: give your designer **shareable preview URLs** to review
every email as members see it today. They deliver either **Figma
annotations** or **standalone HTML files** back. I translate their work
into `lib/email.js` and `lib/email-layout.js`.

---

## Where the templates live

| Layer | File | What's in it |
|---|---|---|
| Visual wrapper | `lib/email-layout.js` | Header with logo, footer, CTA button, detail-box, preheader. Shared across every email. |
| Per-email body | `lib/email.js` | One exported function per transactional email. Builds the body HTML, hands to the wrapper, sends via Resend. |
| Sender config | `tenants.email_from`, `tenants.email_footer_text` | Per-tenant. Edited in Settings → Tenant Email. |
| Brand colors + logo | `tenant_branding` | Per-tenant. Edited in Settings → Branding. |

Every email inherits logo + colors + footer from the branding layer.
The designer **does not need to touch branding values** — those are
already dynamic per tenant. They focus on layout, typography, copy,
and spacing.

---

## The preview viewer (ship this link to the designer)

Every template can be previewed as a member would see it, at a
shareable URL:

```
<your-portal-url>/api/email-preview/<template-slug>
```

Examples:

- `https://hourgolf.ourlee.co/api/email-preview/booking-confirmation`
- `https://hourgolf.ourlee.co/api/email-preview/welcome`
- `https://hourgolf.ourlee.co/api/email-preview/payment-failed`
- `https://hourgolf.ourlee.co/api/email-preview/launch`

The page renders with:

- The live subject line + "from" + "to" displayed at the top
- The email HTML in an iframe below (CSS-isolated, exactly as a mail
  client would render it)
- The plain-text fallback version below that
- A tab row across every other template so the designer can cycle
  without more URLs

### Every available preview slug

- `booking-confirmation` — sent on member booking
- `booking-cancellation` — sent on cancel
- `welcome` — new-member subscription activated
- `payment-receipt` — monthly membership receipt (Stripe invoice.paid)
- `payment-failed` — card declined, first attempt
- `password-reset` — Forgot Password flow
- `launch` — the one-off "the app is here" broadcast
- `shop-request-admin` — member submits "Request an item"
- `shop-request-ready` — admin marks request ready for pickup
- `shop-order-notification` — admin notification of a shop checkout
- `shipment-delivered` — Shippo tracking reports delivered

Admin view: **Config → Email Settings**. Each row has an **Open →**
link that goes straight to the preview. Right-click → Copy link →
send to the designer.

### Things to tell the designer about the preview

- **Sample data is fake** — `sample.member@example.com`, "Alex
  Rivera", "TaylorMade Stealth 2 Driver", etc. They'll see that repeat
  across templates. Designed for visual consistency review.
- **Tenant branding is real** — the logo, colors, and footer reflect
  whichever tenant's subdomain the URL is on. `hourgolf.ourlee.co/…`
  renders as Hour Golf; a future tenant's URL renders as theirs.
- **Iframe isolates CSS** so what they see matches Gmail / Apple Mail
  closely. Real mail clients may still differ slightly (Outlook is
  famously picky); for truly bulletproof testing, use Litmus or
  Email-on-Acid once a design is locked.

---

## Delivery format — what the designer sends back

Either works. Pick whichever matches how they usually design.

### Option A: Figma annotations (easier if they work in Figma)

1. Designer screenshots the current preview URL for each email.
2. Drops them into a Figma file.
3. Annotates on top: "logo 20px smaller", "swap this teal for
   `#2E5D47`", "body copy: `<new copy>`", "move CTA above the detail
   box", etc.
4. Shares the Figma link with you.

You forward the Figma link to me. I translate the changes into
`lib/email.js` + `lib/email-layout.js` and push. Turnaround is usually
one session.

**Good for:** copy changes, spacing tweaks, color/type/layout pushes.
Not good for: they don't want to deliver full HTML themselves.

### Option B: Standalone HTML files (easier if they're HTML-fluent)

1. Designer fetches the raw HTML for a template:
   `?raw=1` appended to the preview URL (e.g.
   `/api/email-preview/welcome?raw=1`) returns just the rendered HTML.
2. They save it locally (`welcome.html`), open in their editor of
   choice, rework the markup + inline CSS.
3. They send me the revised HTML file.
4. I translate their markup back into the `renderEmailLayout` +
   template-body structure, preserving the dynamic variable slots
   (`${customerName}`, `${bay}`, etc.) exactly where they belong.

**Good for:** designers comfortable with table-based email HTML and
inline styles. Gives them the most control.

**What they should keep in mind:**
- Email HTML is intentionally backwards — tables for layout, inline
  styles, no flexbox, no CSS Grid. Gmail strips `<style>` blocks in
  some contexts; iOS Mail and Outlook render things differently.
- Stick to web-safe fonts OR Google Fonts imported via `<link>` in
  the `<head>` (the current template does this).
- Don't inline member-specific data — the dynamic bits are
  `${customerName}`, `${bay}`, `${bookingStart}`, etc. Preserve those
  placeholders and I'll wire them up.

---

## What I'll need in the revised file(s)

However they deliver, I need:

1. **Which template** they're revising (matching a slug from the list
   above). One design per template; the wrapper is shared across all.
2. **Copy changes** verbatim (the exact wording they want).
3. **Any new images** (as URLs I can bundle into Supabase Storage,
   or as files for me to upload).
4. **Brand constants** that should be changeable per tenant vs. fixed
   across all tenants — if they want a new color to be adjustable by
   future tenants, I'll add it to `tenant_branding`.

---

## Recommended order of work

Don't revise all 11 at once. Prioritize by volume + visibility:

1. **Booking confirmation** — every booking. Highest volume.
2. **Welcome email** — every new member. First impression.
3. **Payment receipt** — every monthly charge. Regular touchpoint.
4. **Password reset** — not high volume but branded-by-absence on
   forgot-password flow, so worth polishing early.
5. **Launch announcement** — once, then archived. Lower priority unless
   you're sending the blast soon.
6. **Shop request / order / shipment** — lower volume; bundle these in
   one pass toward the end.
7. **Payment failed** — low volume ideally, but high-stakes copy
   (members are anxious when they see this). Tone matters.

Start with #1 — nail the wrapper + header + footer treatment on the
booking confirmation, and that propagates to every other template via
`email-layout.js`. One design cycle → 11 templates align.

---

## Questions the designer will probably ask

**"Can I see it on mobile?"** Preview URL works on phone. Bookmark it
and open on iOS Safari / Android Chrome to preview the real render
there. For actual mail-client rendering, send themselves the email
via the admin "Send test" button in Config → Launch Announcement (for
the launch email), or ask you to wire a test-send button for any
other template they want to review in an inbox.

**"Can I change the logo / colors?"** Those are tenant-level in
`tenant_branding`. Tell them: they can change the *template* design
all they want; the *logo file* and *brand colors* get piped in at
render time from the tenant's branding config (Settings → Branding),
so every tenant renders with their own. They don't need to hardcode
anything brand-specific.

**"Does Outlook support this CSS?"** Answer varies. Stick to
table-based layout + inline styles + no flexbox/grid, and most of it
works. For deep validation, recommend Litmus ($) or free Email-on-
Acid-style previews via tools like `https://putsmail.com` (send to a
test inbox and open in Outlook directly).

---

## What I'll do when they send work back

1. Read their Figma / HTML.
2. Identify the dynamic variable slots and preserve them exactly where
   they belong.
3. Translate the new layout into `lib/email.js` template literals +
   `lib/email-layout.js` wrapper updates.
4. Deploy to Vercel preview on a branch → share the preview URL → you
   confirm it matches → I merge to main.
5. Repeat per template.
