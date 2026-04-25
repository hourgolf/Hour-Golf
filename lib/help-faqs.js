// Help FAQ defaults + render-time token substitution.
//
// The FAQ tree on the member-facing HelpDrawer is editable per-tenant
// via tenant_branding.help_faqs. When that column is NULL the platform
// default shape (DEFAULT_HELP_FAQS below) is used. When the admin has
// customized it, their stored array wins.
//
// Either source uses {token} placeholders for the dynamic bits so the
// copy stays in sync as the operator updates support contact info,
// facility hours, the cancel cutoff, etc. — without having to re-edit
// every FAQ answer that references them.
//
// Supported tokens — buildTokenContext() owns the mapping. Adding a
// new one is one line here + one line in the admin's token reference
// card in TenantBranding.js so the operator knows it exists.

export const HELP_FAQ_TOKENS = [
  { token: "{venue}",         desc: "Your tenant's display name (app_name)." },
  { token: "{bay}",           desc: "Singular bay/court/sim label, capitalized." },
  { token: "{bay_lower}",     desc: "Same, lowercased — useful mid-sentence." },
  { token: "{cutoff_phrase}", desc: 'Cancel-cutoff window phrase, e.g. "6 hours" or "any time".' },
  { token: "{hours}",         desc: "Facility hours block from Settings." },
  { token: "{support_email}", desc: "Support email from Settings (or empty if blank)." },
  { token: "{support_phone}", desc: "Support phone from Settings (or empty if blank)." },
  { token: "{contact_line}",  desc: 'Auto-built "Email us at … or call/text …" sentence.' },
  { token: "{backup_code}",   desc: "Backup access code (only when access_codes feature is on)." },
];

// Default FAQ shape. Mirrors the prior hardcoded buildFaqCategories()
// output but with every dynamic insertion now a {token}. The
// "access" category's first item is conditional — see the access_codes
// gate below in resolveHelpFaqs() — so the troubleshooting hand-off
// stays out of view for tenants without keypad access.
export const DEFAULT_HELP_FAQS = [
  {
    key: "access",
    label: "Access & Door Codes",
    label_alt_no_access_codes: "Visiting",
    icon: "🔑",
    icon_alt_no_access_codes: "🚪",
    items: [
      // Special marker: the troubleshoot entry is rendered as a button
      // that opens the access-code troubleshooting flow, not as a Q/A.
      // It only appears when access_codes is enabled.
      { q: "My access code isn’t working", a: null, troubleshoot: true, requires: "access_codes" },
      { q: "What are the facility hours?", a: "{hours}" },
      {
        q: "Can I bring a guest?",
        a: "Absolutely! You can bring up to 3 guests per {bay_lower} per booking. Just make sure they’re with you when you enter.",
      },
    ],
  },
  {
    key: "booking",
    label: "Booking & Cancellation",
    icon: "📅",
    items: [
      {
        q: "How do I book a {bay_lower}?",
        a: "Go to the “Book Time” tab, pick your date, {bay_lower}, and time slot, then confirm. You’ll get an email confirmation.",
      },
      {
        q: "How far in advance can I book?",
        a: "You can book up to 7 days in advance. Same-day bookings are available if slots are open.",
      },
      {
        q: "How do I cancel a booking?",
        a: "Go to your Dashboard and find the booking under “Upcoming Bookings.” Click “Cancel” — cancellations must be made at least {cutoff_phrase} before your start time.",
      },
      {
        q: "What’s the cancellation policy?",
        a: "You can cancel free of charge up to {cutoff_phrase} before your booking. Late cancellations or no-shows may be charged. Contact us if you have an emergency.",
      },
      {
        q: "Can I modify a booking?",
        a: "Currently you’ll need to cancel and rebook. We’re working on an edit feature!",
      },
    ],
  },
  {
    key: "billing",
    label: "Billing & Membership",
    icon: "💳",
    items: [
      {
        q: "How does billing work?",
        a: "Monthly membership fees are charged automatically. Overage hours (usage beyond your included hours) are billed at your tier’s overage rate at the end of the billing period.",
      },
      {
        q: "How do I update my payment method?",
        a: "Go to the Billing tab and click “Update Card.” You’ll be redirected to our secure payment portal to update your card details.",
      },
      {
        q: "What are punch passes / bonus hours?",
        a: "Punch passes let you pre-purchase extra {bay_lower} hours at a discount. They never expire and carry over month to month. Buy them on the Billing tab.",
      },
      {
        q: "How do I change my membership tier?",
        a: "Go to the Billing tab under “Membership.” You can upgrade or downgrade your plan. Changes take effect on your next billing cycle.",
      },
      {
        q: "How do I cancel my membership?",
        a: "On the Billing tab, scroll to the Membership section and click “Cancel Membership.” Your access continues until the end of your current billing period.",
      },
    ],
  },
  {
    key: "account",
    label: "Account & Profile",
    icon: "⚙️",
    items: [
      {
        q: "How do I change my email or password?",
        a: "Go to the Account tab. You’ll see separate sections for changing your email and password. Both require your current password to confirm.",
      },
      {
        q: "I forgot my password",
        a: "Contact us directly and we’ll help you reset it. A self-service password reset feature is coming soon.",
      },
    ],
  },
  {
    key: "contact",
    label: "Contact Us",
    icon: "📩",
    items: [
      {
        q: "How do I reach {venue}?",
        a: "{contact_line}",
      },
    ],
  },
];

// Build the token → value map from a branding row + flags.
function buildTokenContext(branding, { accessCodesEnabled } = {}) {
  const venue = branding?.app_name || "us";
  const bay = branding?.bay_label_singular || "Bay";
  const bayLower = bay.toLowerCase();
  const supportEmail = branding?.support_email || "";
  const supportPhone = branding?.support_phone || "";
  const cutoffHours = Number(branding?.cancel_cutoff_hours ?? 6);
  const cutoffPhrase = cutoffHours > 0
    ? `${cutoffHours} hour${cutoffHours === 1 ? "" : "s"}`
    : "any time";
  const hours = branding?.facility_hours || "Please see your venue for hours of access.";
  const backupCode = accessCodesEnabled ? (branding?.backup_access_code || "") : "";

  // contact_line composes the typical "email us at X or call/text Y"
  // sentence the operator otherwise has to write themselves with
  // multiple if-empty checks.
  let contactLine;
  if (supportEmail && supportPhone) {
    contactLine = `Email us at ${supportEmail} or call/text ${supportPhone}. We'll get back to you as quickly as possible.`;
  } else if (supportEmail) {
    contactLine = `Email us at ${supportEmail}. We'll get back to you as quickly as possible.`;
  } else if (supportPhone) {
    contactLine = `Call or text us at ${supportPhone}. We'll get back to you as quickly as possible.`;
  } else {
    contactLine = "Contact info hasn't been set up yet — check with your venue staff.";
  }

  return {
    "{venue}": venue,
    "{bay}": bay,
    "{bay_lower}": bayLower,
    "{cutoff_phrase}": cutoffPhrase,
    "{hours}": hours,
    "{support_email}": supportEmail,
    "{support_phone}": supportPhone,
    "{contact_line}": contactLine,
    "{backup_code}": backupCode,
  };
}

function applyTokens(str, tokens) {
  if (typeof str !== "string") return str;
  let out = str;
  for (const [token, value] of Object.entries(tokens)) {
    if (out.indexOf(token) === -1) continue;
    out = out.split(token).join(value);
  }
  return out;
}

// Resolve the FAQ tree the HelpDrawer should render right now. Reads
// the tenant override if present, otherwise the platform default.
// Filters items by their `requires` flag (e.g. access_codes), swaps
// in alt labels/icons for categories that have them, and substitutes
// every {token} in question + answer copy.
export function resolveHelpFaqs(branding, { accessCodesEnabled = false } = {}) {
  const source = Array.isArray(branding?.help_faqs) && branding.help_faqs.length > 0
    ? branding.help_faqs
    : DEFAULT_HELP_FAQS;

  const tokens = buildTokenContext(branding, { accessCodesEnabled });

  return source.map((cat) => {
    const items = (cat.items || [])
      .filter((it) => {
        if (!it || !it.q) return false;
        if (it.requires === "access_codes" && !accessCodesEnabled) return false;
        return true;
      })
      .map((it) => ({
        q: applyTokens(it.q, tokens),
        a: it.a == null ? null : applyTokens(it.a, tokens),
        troubleshoot: !!it.troubleshoot,
      }));

    const label = (!accessCodesEnabled && cat.label_alt_no_access_codes) || cat.label;
    const icon  = (!accessCodesEnabled && cat.icon_alt_no_access_codes)  || cat.icon;

    return { key: cat.key, label, icon, items };
  }).filter((cat) => cat.items.length > 0);
}
