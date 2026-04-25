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
  },
  "booking-cancellation": {
    label: "Booking Cancellation",
    fields: ["subject", "preheader", "intro", "outro", "cta_label"],
    tokens: TOKENS_BOOKING,
  },
  "access-code": {
    label: "Access Code",
    fields: ["subject", "preheader", "intro", "outro", "cta_label"],
    tokens: [
      ...TOKENS_BOOKING,
      { token: "{access_code}", desc: "The 6-digit door code (only visible in this template)" },
    ],
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
  },
  "payment-failed": {
    label: "Payment Failed",
    fields: ["subject", "preheader", "intro", "outro", "cta_label"],
    tokens: [
      ...TOKENS_NAME_VENUE,
      { token: "{amount}",      desc: "Amount that failed (e.g. '75.00')" },
      { token: "{description}", desc: "Charge description" },
    ],
  },
  "password-reset": {
    label: "Password Reset",
    fields: ["subject", "preheader", "intro", "outro", "cta_label"],
    tokens: [
      ...TOKENS_NAME_VENUE,
      { token: "{reset_url}", desc: "One-time reset link (also wired to the CTA button)" },
    ],
  },
  "launch": {
    label: "App Launch Announcement",
    fields: ["subject", "preheader", "intro", "outro", "cta_label"],
    tokens: TOKENS_NAME_VENUE,
  },
  "cutover-announcement": {
    label: "Skedda Cutover — Announcement",
    fields: ["subject", "preheader", "intro", "outro", "cta_label"],
    tokens: [
      ...TOKENS_NAME_VENUE,
      { token: "{cutover_date}", desc: "Cutover date (e.g. 'Mon, May 11')" },
    ],
  },
  "cutover-reminder": {
    label: "Skedda Cutover — Reminder",
    fields: ["subject", "preheader", "intro", "outro", "cta_label"],
    tokens: [
      ...TOKENS_NAME_VENUE,
      { token: "{cutover_date}", desc: "Cutover date (e.g. 'Mon, May 11')" },
    ],
  },
  "cutover-complete-member": {
    label: "Skedda Cutover — Complete (existing app user)",
    fields: ["subject", "preheader", "intro", "outro", "cta_label"],
    tokens: TOKENS_NAME_VENUE,
  },
  "cutover-complete-new": {
    label: "Skedda Cutover — Complete (new to app)",
    fields: ["subject", "preheader", "intro", "outro", "cta_label"],
    tokens: TOKENS_NAME_VENUE,
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
  },
  "shipment-delivered": {
    label: "Shipment Delivered",
    fields: ["subject", "preheader", "intro", "outro", "cta_label"],
    tokens: [
      ...TOKENS_NAME_VENUE,
      { token: "{tracking_number}", desc: "Tracking number" },
      { token: "{carrier}",         desc: "Carrier (USPS, UPS, etc.)" },
    ],
  },
};

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
