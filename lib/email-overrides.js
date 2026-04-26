// Per-template editable copy. Each transactional email in lib/email.js
// reads its overrides from tenant_branding.email_overrides[slug] and
// falls back to the hardcoded prose when no override exists. The
// override path lets admins edit subject/intro/outro/CTA on the
// preview page without a code change.
//
// Token substitution happens here, not in lib/email.js — every
// override value is treated as a template that can reference
// per-template tokens (e.g. {name}, {venue}, {bay}, {access_code}).
//
// Adding a new editable template:
//   1. Add an entry to TEMPLATE_FIELDS below (which fields are
//      editable + which tokens that template supports).
//   2. In lib/email.js, before computing subject + the body
//      paragraphs, call buildTemplateContext + use applyOverride()
//      to override each piece of prose. Pattern is: keep the default
//      string in code, pass it as the fallback to applyOverride().
//   3. The preview page picks up the new template automatically as
//      long as its slug is in TEMPLATES (pages/api/email-preview/...).

// Per-template editable fields + supported tokens. The preview-page
// editor reads this to know which form fields to render and which
// tokens to surface in the help text.
// Common token sets reused across templates so adding a new template
// is just "pick which set fits" rather than "redefine every token".
const TOKENS_NAME_VENUE = [
  { token: "{name}",     desc: "Customer's name" },
  { token: "{venue}",    desc: "Your venue / brand name" },
];
const TOKENS_BOOKING = [
  ...TOKENS_NAME_VENUE,
  { token: "{bay}",      desc: "Bay/court/sim they booked (e.g. 'Bay 2')" },
  { token: "{bay_label}",desc: "Singular bay/court/sim label, lowercase" },
  { token: "{date}",     desc: "Booking date (e.g. 'Wed, Apr 26')" },
  { token: "{time}",     desc: "Time range (e.g. '5:00 PM – 6:00 PM')" },
  { token: "{duration}", desc: "Duration phrase (e.g. '1 hour')" },
];

export const TEMPLATE_FIELDS = {
  "booking-confirmation": {
    label: "Booking Confirmation",
    fields: ["subject", "preheader", "intro", "outro", "cta_label"],
    tokens: TOKENS_BOOKING,
    defaults: {
      subject:   "Booked: {date} at {time} · {bay}",
      preheader: "{date} · {time} · {bay}",
      intro:     "Hey {name},\n\nYour {bay_label} is booked. Here are the details:",
      outro:     "You can cancel from your member portal up to the cancellation cutoff before your booking.",
      cta_label: "View in dashboard",
    },
  },
  "booking-cancellation": {
    label: "Booking Cancellation",
    fields: ["subject", "preheader", "intro", "outro", "cta_label"],
    tokens: TOKENS_BOOKING,
    defaults: {
      subject:   "Cancelled: {date} at {time}",
      preheader: "Cancelled: {date} · {time}",
      intro:     "Hey {name},\n\nYour booking has been cancelled.",
      outro:     "Want to rebook? Tap below.",
      cta_label: "Book a {bay_label}",
    },
  },
  "access-code": {
    label: "Access Code",
    fields: ["subject", "preheader", "intro", "outro", "cta_label"],
    tokens: [
      ...TOKENS_BOOKING,
      { token: "{access_code}", desc: "The 6-digit door code (only visible in this template)" },
    ],
    defaults: {
      subject:   "Your {venue} access code — {date}, {time}",
      preheader: "Your door code for {date} at {time}.",
      intro:     "Hey {name},\n\nYour booking at {venue} is coming up:",
      outro:     "This code works from 10 minutes before your booking through 10 minutes after. Enter it on the keypad at the front door.",
      cta_label: "View booking",
    },
  },
  "welcome": {
    label: "Welcome (new member)",
    fields: ["subject", "preheader", "intro", "outro", "cta_label"],
    tokens: [
      ...TOKENS_NAME_VENUE,
      { token: "{tier}",          desc: "Member's tier name (e.g. 'Patron')" },
      { token: "{monthly_fee}",   desc: "Monthly fee in dollars, no $ sign (e.g. '75')" },
      { token: "{included_hours}",desc: "Included hours per month (e.g. '2', or 'Unlimited')" },
    ],
    defaults: {
      subject:   "Welcome to {venue} · {tier} member",
      preheader: "You're in. {tier} member · {included_hours} hours each month.",
      intro:     "Hey {name},\n\nWelcome to {venue} — you're officially a {tier} member. Here's your plan at a glance:",
      outro:     "Everything you need lives in the member portal — book bays, check your usage, shop the pro shop, adjust your plan whenever you like.",
      cta_label: "Book your first bay",
    },
  },
  "payment-receipt": {
    label: "Payment Receipt",
    fields: ["subject", "preheader", "intro", "outro", "cta_label"],
    tokens: [
      ...TOKENS_NAME_VENUE,
      { token: "{amount}",      desc: "Amount in dollars (e.g. '75.00')" },
      { token: "{description}", desc: "Charge description (e.g. 'Patron Membership')" },
      { token: "{date}",        desc: "Receipt date (e.g. 'April 25, 2026')" },
    ],
    defaults: {
      subject:   "Receipt: ${amount} · {venue}",
      preheader: "${amount} · {description}",
      intro:     "Hey {name},\n\nHere's your receipt:",
      outro:     "Your full billing history is in the member portal.",
      cta_label: "View billing",
    },
  },
  "payment-failed": {
    label: "Payment Failed",
    fields: ["subject", "preheader", "intro", "outro", "cta_label"],
    tokens: [
      ...TOKENS_NAME_VENUE,
      { token: "{amount}",      desc: "Amount that failed (e.g. '75.00')" },
      { token: "{description}", desc: "Charge description" },
    ],
    defaults: {
      subject:   "Update your card — {venue} payment declined",
      preheader: "Update your card to keep your {venue} membership active.",
      intro:     "Hey {name},\n\nYour most recent {venue} membership payment didn't go through — usually the card on file expired, the bank flagged it, or the limit was hit. Nothing's wrong on your end if you weren't expecting it.",
      outro:     "Tap the button below to update your card. Once a new card is on file, we'll retry the charge automatically — you don't need to do anything else.\n\nYour access + booking window stay active while you sort this out. If we don't hear back we'll try the card again in a few days.",
      cta_label: "Update card",
    },
  },
  "password-reset": {
    label: "Password Reset",
    fields: ["subject", "preheader", "intro", "outro", "cta_label"],
    tokens: [
      ...TOKENS_NAME_VENUE,
      { token: "{reset_url}", desc: "One-time reset link (also wired to the CTA button)" },
    ],
    defaults: {
      subject:   "Reset your {venue} password",
      preheader: "Reset your {venue} password (link expires in 1 hour)",
      intro:     "Hey {name},\n\nWe received a request to reset your password. Tap below to choose a new one.",
      outro:     "This link expires in 1 hour. If you didn't request a reset, you can safely ignore this email.",
      cta_label: "Reset password",
    },
  },
  "launch": {
    label: "App Launch Announcement",
    fields: ["subject", "preheader", "intro", "outro", "cta_label"],
    tokens: TOKENS_NAME_VENUE,
    defaults: {
      subject:   "The {venue} APP is LIVE",
      preheader: "Booking, door codes, pro shop, membership — all in your pocket. Get set up in two minutes.",
      intro:     "Hey {name},\n\nI'm excited to share that the new app custom built for {venue} has LAUNCHED! I'm pretty excited about this one, and i think you will be too...\n\nIt's the new home for everything you do with the club — booking a bay, edit and extend sessions, access door codes, see upcoming events, peruse the pro shop and make requests, and control your membership — all in one place on your phone.",
      outro:     "Questions or need a hand getting in? Just hit reply — I'd love to help.",
      cta_label: "Open {venue}",
    },
  },
  "cutover-announcement": {
    label: "Skedda Cutover — Announcement",
    fields: ["subject", "preheader", "intro", "outro", "cta_label"],
    tokens: [
      ...TOKENS_NAME_VENUE,
      { token: "{cutover_date}", desc: "Cutover date (e.g. 'Mon, May 11')" },
    ],
    defaults: {
      subject:   "Meet the new {venue} app",
      preheader: "Booking, door codes, pro shop, membership — all in your pocket. Get set up in two minutes.",
      intro:     "Hey {name},\n\nWe're excited to share that the new {venue} app is ready. It's the new home for everything — booking a bay, your live door code, the pro shop, and your membership — all in one place on your phone.\n\nOn {cutover_date}, the app will become the ONLY way to book with us, and our old Skedda page will retire (RIP). You've got plenty of runway to get signed in whenever it's convenient. Let me know if i can help in any way",
      outro:     "Any time before {cutover_date} works — once you're signed in, you're set.\n\nQuestions or need a hand getting in? Just hit reply — we'd love to help.",
      cta_label: "Open {venue}",
    },
  },
  "cutover-reminder": {
    label: "Skedda Cutover — Reminder",
    fields: ["subject", "preheader", "intro", "outro", "cta_label"],
    tokens: [
      ...TOKENS_NAME_VENUE,
      { token: "{cutover_date}", desc: "Cutover date (e.g. 'Mon, May 11')" },
    ],
    defaults: {
      subject:   "Heads up — {venue} app switchover on {cutover_date}",
      preheader: "Switchover is coming — here's the two-minute setup.",
      intro:     "Hey {name},\n\nJust a friendly nudge — the {venue} app takes over for booking on {cutover_date}, and we wanted to make sure you had a chance to get signed in before then.\n\nOnce you're set up, reserving your next session is just a couple of taps from your home screen. Here's the quick walkthrough:",
      outro:     "If anything is getting in the way, reply to this email and we'll get you sorted. Happy to walk you through it by phone or text too.",
      cta_label: "Open {venue}",
    },
  },
  "cutover-complete-member": {
    label: "Skedda Cutover — Complete (existing app user)",
    fields: ["subject", "preheader", "intro", "outro", "cta_label"],
    tokens: TOKENS_NAME_VENUE,
    defaults: {
      subject:   "The {venue} app is now live",
      preheader: "You're set. Booking, door codes, pro shop — all in your pocket.",
      intro:     "Hey {name},\n\nToday's the day — the new {venue} app officially takes over for booking. Thanks for making the switch early; you're all set.",
      outro:     "Thanks for coming along for the ride. See you at the club.",
      cta_label: "Open {venue}",
    },
  },
  "cutover-complete-new": {
    label: "Skedda Cutover — Complete (new to app)",
    fields: ["subject", "preheader", "intro", "outro", "cta_label"],
    tokens: TOKENS_NAME_VENUE,
    defaults: {
      subject:   "Welcome to the {venue} app",
      preheader: "Today's the switchover. Here's the quick setup whenever you're ready.",
      intro:     "Hey {name},\n\nToday's the day the new {venue} app becomes the home for booking. Whenever you're ready, here's the walkthrough to get you in:",
      outro:     "Once you're in, booking your next session is just a couple of taps. If anything is in the way, reply to this email — we'd love to help you through it.",
      cta_label: "Open {venue}",
    },
  },
  "booking-conflict-alert": {
    label: "Booking Conflict (admin alert)",
    fields: ["subject", "preheader", "intro", "outro"],
    tokens: [
      { token: "{venue}",          desc: "Your venue / brand name" },
      { token: "{bay}",            desc: "Bay where the conflict occurred" },
      { token: "{date}",           desc: "Date of the conflict" },
      { token: "{time}",           desc: "Time of the conflict" },
      { token: "{existing_name}",  desc: "Name of the member already booked" },
      { token: "{existing_email}", desc: "Email of the member already booked" },
      { token: "{incoming_name}",  desc: "Name of the conflicting incoming booking" },
      { token: "{incoming_email}", desc: "Email of the conflicting incoming booking" },
    ],
    defaults: {
      subject:   "Double booking: {bay} at {time}",
      preheader: "{existing_name} and {incoming_name} both booked the same slot.",
      intro:     "Two bookings landed on the same bay at the same time.\n\nThis usually happens when a member books via the legacy Skedda flow while another member just booked the same slot in the new portal. Both bookings are recorded — reach out to one of them to reschedule.",
      outro:     "Open the admin dashboard → Today — both bookings are flagged with a red CONFLICT chip so you can jump straight to them.",
    },
  },
  "shop-request-admin": {
    label: "Pro Shop Request (admin notification)",
    fields: ["subject", "preheader", "intro", "outro"],
    tokens: [
      { token: "{venue}",        desc: "Your venue / brand name" },
      { token: "{item_name}",    desc: "What the member requested" },
      { token: "{brand}",        desc: "Brand they specified (or empty)" },
      { token: "{member_name}",  desc: "Member who made the request" },
      { token: "{member_email}", desc: "Member's email" },
    ],
    defaults: {
      subject:   "Pro Shop request: {item_name}",
      preheader: "{member_name}: {item_name}",
      intro:     "{member_name} would like:",
      outro:     "Contact: {member_email}",
    },
  },
  "shop-request-ready": {
    label: "Pro Shop Request — Ready",
    fields: ["subject", "preheader", "intro", "outro", "cta_label"],
    tokens: [
      ...TOKENS_NAME_VENUE,
      { token: "{item_name}",      desc: "Item name from the request" },
      { token: "{brand}",          desc: "Brand (or empty)" },
      { token: "{admin_response}", desc: "Notes the admin typed when marking ready" },
    ],
    defaults: {
      subject:   "Your {venue} request is ready: {item_name}",
      preheader: "{item_name} ready for pickup at {venue}",
      intro:     "Hey {name},\n\nGood news — the item you requested is ready to pick up at {venue}.",
      outro:     "Come grab it on your next visit. Thanks for letting us know what you wanted.",
      cta_label: "Open Pro Shop",
    },
  },
  "shop-order-notification": {
    label: "Pro Shop Order (admin notification)",
    fields: ["subject", "preheader", "intro", "outro"],
    tokens: [
      { token: "{venue}",           desc: "Your venue / brand name" },
      { token: "{order_id}",        desc: "Order ID for reference" },
      { token: "{member_name}",     desc: "Member who placed the order" },
      { token: "{member_email}",    desc: "Member's email" },
      { token: "{total}",           desc: "Total in dollars (e.g. '105.50')" },
      { token: "{delivery_method}", desc: "'pickup' or 'shipping'" },
    ],
    defaults: {
      subject:   "Pro Shop order: {member_name} · ${total}",
      preheader: "{member_name} · ${total}",
      intro:     "{member_name} just placed an order.",
      outro:     "Payment collected. Items ready for pickup at next visit.",
    },
  },
  "shipment-delivered": {
    label: "Shipment Delivered",
    fields: ["subject", "preheader", "intro", "outro", "cta_label"],
    tokens: [
      ...TOKENS_NAME_VENUE,
      { token: "{tracking_number}", desc: "Tracking number" },
      { token: "{carrier}",         desc: "Carrier (USPS, UPS, etc.)" },
    ],
    defaults: {
      subject:   "Delivered: your {venue} order",
      preheader: "Your {venue} order arrived",
      intro:     "Good news — your {venue} order just arrived.",
      outro:     "See all of your orders anytime in the {venue} portal.",
      cta_label: "View orders",
    },
  },
  "shop-refund": {
    label: "Pro Shop Refund Notice",
    fields: ["subject", "preheader", "intro", "outro", "cta_label"],
    tokens: [
      ...TOKENS_NAME_VENUE,
      { token: "{amount}", desc: "Refund amount in dollars (e.g. '45.00')" },
      { token: "{reason}", desc: "Reason text from the admin (or empty)" },
    ],
    defaults: {
      subject:   "Refund: ${amount} · {venue}",
      preheader: "${amount} refunded · {venue}",
      intro:     "Hey {name},\n\nWe've issued a refund on your {venue} pro shop order.",
      outro:     "It can take 5–10 business days for your bank to show the credit.",
      cta_label: "View your orders",
    },
  },
  "abandoned-cart": {
    label: "Abandoned Cart Reminder",
    fields: ["subject", "preheader", "intro", "outro", "cta_label"],
    tokens: [
      ...TOKENS_NAME_VENUE,
      { token: "{total}", desc: "Cart total in dollars (e.g. '95.00')" },
    ],
    defaults: {
      subject:   "Still thinking it over? · {venue}",
      preheader: "Your {venue} cart is waiting",
      intro:     "Hey {name},\n\nYou left some good stuff in your {venue} pro shop cart.",
      outro:     "Stock is limited on drops — pick up where you left off.",
      cta_label: "Back to the shop",
    },
  },
};

// Convenience: pull just the defaults for a slug, returns {} for
// unknown slugs so callers can spread safely.
export function getTemplateDefaults(slug) {
  return TEMPLATE_FIELDS[slug]?.defaults || {};
}

// Pull the override blob for a single template slug. Returns {} if
// the column is null or the slug isn't present.
export function getTemplateOverrides(branding, slug) {
  const all = branding && typeof branding.email_overrides === "object" ? branding.email_overrides : null;
  if (!all || typeof all !== "object" || Array.isArray(all)) return {};
  const t = all[slug];
  return t && typeof t === "object" && !Array.isArray(t) ? t : {};
}

// Substitute {token} placeholders in a string using the provided
// context map. Returns the input unchanged if it isn't a string or
// has no tokens.
export function applyTokens(str, tokens) {
  if (typeof str !== "string") return str;
  if (!tokens || typeof tokens !== "object") return str;
  let out = str;
  for (const [token, value] of Object.entries(tokens)) {
    if (out.indexOf(token) === -1) continue;
    out = out.split(token).join(value == null ? "" : String(value));
  }
  return out;
}

// Resolve a single field for a template. Override wins; falls back
// to the default. Tokens substituted on whichever wins so callers
// can use the same {name}/{venue} placeholders in either path.
export function applyOverride(defaultValue, branding, slug, field, tokens) {
  const overrides = getTemplateOverrides(branding, slug);
  const raw = overrides[field];
  const useOverride = typeof raw === "string" && raw.trim().length > 0;
  return applyTokens(useOverride ? raw : defaultValue, tokens);
}

// Bounds enforced server-side in admin-tenant-branding. Surfaced
// here so the preview-page editor can show character counters that
// match what the API will accept on save.
export const FIELD_LIMITS = {
  subject:   { max: 200, multiline: false },
  preheader: { max: 200, multiline: false },
  intro:     { max: 2000, multiline: true },
  outro:     { max: 2000, multiline: true },
  cta_label: { max: 60, multiline: false },
};

// Validate one slug's override blob. Returns null on success, an
// error message on failure. Used by admin-tenant-branding's PATCH
// validator + can be used by the editor for client-side feedback.
export function validateTemplateOverrides(slug, blob) {
  const meta = TEMPLATE_FIELDS[slug];
  if (!meta) return `Unknown template: ${slug}`;
  if (!blob || typeof blob !== "object" || Array.isArray(blob)) return "Override must be an object";
  for (const [field, value] of Object.entries(blob)) {
    if (!meta.fields.includes(field)) {
      return `Field "${field}" is not editable for template "${slug}"`;
    }
    if (value === null || value === "") continue; // explicit clear
    if (typeof value !== "string") return `Field "${field}" must be a string`;
    const limit = FIELD_LIMITS[field];
    if (limit && value.length > limit.max) {
      return `Field "${field}" too long (max ${limit.max} chars)`;
    }
  }
  return null;
}

// Validate the full email_overrides blob (object keyed by slug).
export function validateAllOverrides(blob) {
  if (blob === null) return null; // explicit clear
  if (typeof blob !== "object" || Array.isArray(blob)) return "email_overrides must be an object or null";
  for (const [slug, sub] of Object.entries(blob)) {
    const err = validateTemplateOverrides(slug, sub);
    if (err) return err;
  }
  return null;
}
