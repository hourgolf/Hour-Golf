import { getTenantId } from "../../lib/api-helpers";
import { validateDiscountCode } from "../../lib/discount-codes";
import { getSessionWithMember } from "../../lib/member-session";

// Checkout helper: POST { code, subtotal_cents } → returns the
// discount this code WOULD apply on the current cart. No side
// effects; the actual debit happens during checkout and is validated
// again server-side.
//
// Auto-detects whether the caller is a member (via the member
// session cookie) or a guest. Member = not-isGuest for scope rules.

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach((c) => {
    const [k, ...v] = c.trim().split("=");
    if (k) cookies[k] = v.join("=");
  });
  return cookies;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { code, subtotal_cents } = req.body || {};
  if (!code) return res.status(400).json({ error: "code required" });
  const subtotalCents = Math.max(0, Number(subtotal_cents) || 0);

  const tenantId = getTenantId(req);

  // Detect member session (non-fatal if cookie is absent).
  let memberEmail = null;
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["hg-member-token"];
  if (token) {
    try {
      const sess = await getSessionWithMember({ token, tenantId, touch: false });
      if (sess?.member?.email) memberEmail = sess.member.email;
    } catch { /* treat as guest */ }
  }

  const result = await validateDiscountCode({
    tenantId,
    code,
    subtotalCents,
    memberEmail,
    isGuest: !memberEmail,
  });

  if (!result.ok) {
    return res.status(200).json({ valid: false, message: result.message });
  }
  return res.status(200).json({
    valid: true,
    amount_cents: result.amountCents,
    code: result.code.code,
    type: result.code.type,
    value: Number(result.code.value),
    message: `${result.code.code} applied — saving $${(result.amountCents / 100).toFixed(2)}.`,
  });
}
