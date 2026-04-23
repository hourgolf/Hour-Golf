// Shared server-side validation + application of a discount code.
// Used by /api/validate-discount-code (no side effect — returns the
// amount that WOULD apply), /api/member-shop (checkout) and
// /api/public-shop (checkout).
//
// Policy:
//   - Codes are case-insensitive (stored verbatim, matched on upper()).
//   - Codes don't stack with the member tier discount. If a member
//     applies a code, their effective tier discount is 0 for that
//     order. Sale prices still take priority over tier (unchanged).
//   - total_uses and usage_limit_per_member are enforced here.
//   - Expiry is strictly in the past = invalid.

import { SUPABASE_URL, getServiceKey } from "./api-helpers";

export async function findActiveDiscountCode({ tenantId, code }) {
  if (!code || typeof code !== "string") return null;
  const key = getServiceKey();
  const q = new URLSearchParams();
  q.set("tenant_id", `eq.${tenantId}`);
  q.set("is_active", "eq.true");
  q.set("code", `ilike.${code.trim()}`);
  q.set("limit", "1");
  const r = await fetch(`${SUPABASE_URL}/rest/v1/discount_codes?${q.toString()}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0] || null;
}

// Validate + compute the discount for the given cart context.
// Returns { ok: true, code, amountCents, message } on success.
// Returns { ok: false, message } on failure.
//
// subtotalCents  should be the subtotal AFTER per-item sale pricing
//                but BEFORE any tier discount. The function computes
//                the discount-code amount against this number.
// context        { tenantId, memberEmail (or null for guest), isGuest }
export async function validateDiscountCode({ tenantId, code, subtotalCents, memberEmail = null, isGuest = false }) {
  const row = await findActiveDiscountCode({ tenantId, code });
  if (!row) return { ok: false, message: "That code isn't valid." };

  const now = Date.now();
  if (row.expires_at && new Date(row.expires_at).getTime() <= now) {
    return { ok: false, message: "That code has expired." };
  }
  if (row.scope === "member" && isGuest) {
    return { ok: false, message: "That code is members only." };
  }
  if (row.scope === "public" && !isGuest) {
    return { ok: false, message: "That code is for guest checkout." };
  }
  if (row.min_order_cents && subtotalCents < row.min_order_cents) {
    const dollars = (row.min_order_cents / 100).toFixed(2);
    return { ok: false, message: `This code needs a subtotal of at least $${dollars}.` };
  }
  if (row.usage_limit_total && (row.total_uses || 0) >= row.usage_limit_total) {
    return { ok: false, message: "That code has reached its usage limit." };
  }

  if (row.usage_limit_per_member && memberEmail) {
    const key = getServiceKey();
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/shop_orders?tenant_id=eq.${tenantId}&discount_code_id=eq.${row.id}&member_email=eq.${encodeURIComponent(memberEmail)}&select=id`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const used = r.ok ? await r.json() : [];
    if (used.length >= row.usage_limit_per_member) {
      return { ok: false, message: "You've already used this code the maximum number of times." };
    }
  }

  let amountCents;
  if (row.type === "percent") {
    amountCents = Math.round(subtotalCents * (Number(row.value) / 100));
  } else {
    amountCents = Math.round(Number(row.value) * 100); // value stored as dollars
  }
  amountCents = Math.min(amountCents, subtotalCents); // never negative
  amountCents = Math.max(0, amountCents);

  return { ok: true, code: row, amountCents };
}

// Bump total_uses after a successful checkout. Best-effort; a failed
// bump doesn't roll back the order (the order record has
// discount_code_id for reporting, which is the authoritative count).
export async function bumpDiscountCodeUse(row) {
  if (!row?.id) return;
  const key = getServiceKey();
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/discount_codes?id=eq.${row.id}`,
      {
        method: "PATCH",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ total_uses: (row.total_uses || 0) + 1 }),
      }
    );
  } catch (e) {
    console.warn("bumpDiscountCodeUse failed:", e?.message || e);
  }
}
