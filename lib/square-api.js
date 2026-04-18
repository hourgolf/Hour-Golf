// Thin REST wrapper for the Square API. We call Square directly rather
// than depending on the `square` Node SDK so the bundle stays small and
// we aren't coupled to the SDK's upgrade cadence. All methods here are
// stateless — the caller passes credentials, we return parsed JSON.
//
// Square REST docs: https://developer.squareup.com/reference/square
// Error shape: { errors: [{ code, detail, field? }] }

const SQUARE_VERSION = "2025-01-23";

// Retry budget for 429 RATE_LIMITED responses. Square's SearchCustomers
// endpoint has a particularly low ceiling (~30/min observed in practice);
// exponential backoff lets a batched run like the backfill survive short
// throttle windows without the caller needing to re-drive the whole run.
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

function buildHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Square-Version": SQUARE_VERSION,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function squareFetch(apiBase, accessToken, path, init = {}) {
  const url = `${apiBase}${path}`;
  let lastErr = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const resp = await fetch(url, {
      ...init,
      headers: { ...buildHeaders(accessToken), ...(init.headers || {}) },
    });
    const text = await resp.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    if (resp.ok) return body;

    const err = new Error(
      body?.errors?.[0]?.detail ||
      body?.errors?.[0]?.code ||
      `Square API ${resp.status} ${path}`
    );
    err.status = resp.status;
    err.errors = body?.errors || [];
    err.body = body;

    const isRateLimited =
      resp.status === 429 ||
      body?.errors?.some((e) => e.code === "RATE_LIMITED");
    if (!isRateLimited || attempt === MAX_RETRIES) throw err;

    // Respect Retry-After header if present (in seconds per HTTP spec),
    // else use exponential backoff: 1s, 2s, 4s.
    const hdr = resp.headers.get("retry-after");
    const waitMs = hdr
      ? Math.max(1, Number(hdr)) * 1000
      : RETRY_BASE_MS * Math.pow(2, attempt);
    await sleep(waitMs);
    lastErr = err;
  }
  throw lastErr;
}

export { sleep };

// Paginated customer list. Square paginates with `cursor` in request
// body / query. We return a generator-like helper that fetches until
// exhausted. Typical tenant has <1000 customers so we cap at 10 pages.
//
// Returns Array<SquareCustomer>.
export async function listAllCustomers({ apiBase, accessToken }) {
  const out = [];
  let cursor = null;
  let guard = 0;
  do {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const data = await squareFetch(apiBase, accessToken, `/v2/customers${query}`);
    const rows = data?.customers || [];
    out.push(...rows);
    cursor = data?.cursor || null;
    guard += 1;
  } while (cursor && guard < 50);
  return out;
}

// Search by exact email. Square's SearchCustomers filters are
// case-insensitive for email (per docs), but we still normalize caller
// side to be safe.
export async function searchCustomerByEmail({ apiBase, accessToken, email }) {
  const data = await squareFetch(apiBase, accessToken, "/v2/customers/search", {
    method: "POST",
    body: JSON.stringify({
      query: {
        filter: {
          email_address: { exact: email.trim().toLowerCase() },
        },
      },
      limit: 5,
    }),
  });
  return data?.customers || [];
}

// Create a customer with an explicit reference_id so the QR round-trip
// works immediately. Idempotency key is caller-provided; we recommend
// the member UUID so retries don't create duplicates.
export async function createCustomer({
  apiBase, accessToken, email, givenName, familyName, referenceId, idempotencyKey,
}) {
  const data = await squareFetch(apiBase, accessToken, "/v2/customers", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: idempotencyKey,
      email_address: email,
      given_name: givenName || undefined,
      family_name: familyName || undefined,
      reference_id: referenceId,
    }),
  });
  return data?.customer || null;
}

// Patch an existing customer's reference_id. Used during backfill when
// Square already has the person but no reference_id yet.
export async function updateCustomerReferenceId({
  apiBase, accessToken, customerId, referenceId,
}) {
  const data = await squareFetch(apiBase, accessToken, `/v2/customers/${encodeURIComponent(customerId)}`, {
    method: "PUT",
    body: JSON.stringify({ reference_id: referenceId }),
  });
  return data?.customer || null;
}

// Patch a customer's free-form note field. Phase 3 uses this to surface
// the member's HG tier + discount at the Square POS customer profile
// so staff can apply the tier discount manually (or set up automatic
// rules against the note downstream). Accepts any subset of fields.
export async function updateCustomer({
  apiBase, accessToken, customerId, patch,
}) {
  const data = await squareFetch(apiBase, accessToken, `/v2/customers/${encodeURIComponent(customerId)}`, {
    method: "PUT",
    body: JSON.stringify(patch || {}),
  });
  return data?.customer || null;
}

// List all customer groups defined under the Square account. Used to
// ensure "HG tier: <Tier>" groups exist before we assign members.
export async function listCustomerGroups({ apiBase, accessToken }) {
  const data = await squareFetch(apiBase, accessToken, "/v2/customers/groups");
  return data?.groups || [];
}

// Idempotent create — Square will error if a group with the same name
// already exists; callers should reuse existing ones via listCustomerGroups.
export async function createCustomerGroup({ apiBase, accessToken, name }) {
  const data = await squareFetch(apiBase, accessToken, "/v2/customers/groups", {
    method: "POST",
    body: JSON.stringify({ group: { name } }),
  });
  return data?.group || null;
}

export async function addCustomerToGroup({
  apiBase, accessToken, customerId, groupId,
}) {
  // Square's spec: PUT /v2/customers/{customer_id}/groups/{group_id}
  // Body is empty. Returns { /* empty on success */ }.
  await squareFetch(apiBase, accessToken, `/v2/customers/${encodeURIComponent(customerId)}/groups/${encodeURIComponent(groupId)}`, {
    method: "PUT",
    body: JSON.stringify({}),
  });
  return true;
}

export async function removeCustomerFromGroup({
  apiBase, accessToken, customerId, groupId,
}) {
  await squareFetch(apiBase, accessToken, `/v2/customers/${encodeURIComponent(customerId)}/groups/${encodeURIComponent(groupId)}`, {
    method: "DELETE",
  });
  return true;
}

// ---- gift cards ----------------------------------------------------------

// Create a DIGITAL gift card. New cards are in state PENDING until the
// first ACTIVATE activity loads an initial balance. Caller typically
// follows up with linkGiftCardToCustomer + activateGiftCard.
export async function createDigitalGiftCard({
  apiBase, accessToken, locationId, idempotencyKey,
}) {
  const data = await squareFetch(apiBase, accessToken, "/v2/gift-cards", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: idempotencyKey,
      location_id: locationId,
      gift_card: { type: "DIGITAL" },
    }),
  });
  return data?.gift_card || null;
}

// Bind a gift card to a Square customer record so it auto-applies when
// that customer is scanned at the Register.
export async function linkGiftCardToCustomer({
  apiBase, accessToken, giftCardId, customerId,
}) {
  const data = await squareFetch(apiBase, accessToken, `/v2/gift-cards/${encodeURIComponent(giftCardId)}/link-customer`, {
    method: "POST",
    body: JSON.stringify({ customer_id: customerId }),
  });
  return data?.gift_card || null;
}

export async function getGiftCardById({ apiBase, accessToken, giftCardId }) {
  const data = await squareFetch(apiBase, accessToken, `/v2/gift-cards/${encodeURIComponent(giftCardId)}`);
  return data?.gift_card || null;
}

// Move a PENDING card into ACTIVE with an initial balance. Required on
// the very first load — subsequent balance changes use adjustGiftCard.
export async function activateGiftCard({
  apiBase, accessToken, locationId, giftCardId, amountCents, idempotencyKey,
}) {
  const data = await squareFetch(apiBase, accessToken, "/v2/gift-card-activities", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: idempotencyKey,
      gift_card_activity: {
        type: "ACTIVATE",
        location_id: locationId,
        gift_card_id: giftCardId,
        activate_activity_details: {
          amount_money: { amount: amountCents, currency: "USD" },
        },
      },
    }),
  });
  return data?.gift_card_activity || null;
}

// Merchant-initiated up/down on the balance. ADJUST_INCREMENT to load
// (e.g. loyalty reward), ADJUST_DECREMENT to remove (e.g. clawback or
// sync down after external spend). Square scopes the reason enum per
// direction — keep to 'OTHER' for broad compatibility.
export async function adjustGiftCard({
  apiBase, accessToken, locationId, giftCardId, deltaCents, direction, reason, idempotencyKey,
}) {
  if (direction !== "INCREMENT" && direction !== "DECREMENT") {
    throw new Error(`adjustGiftCard: direction must be INCREMENT or DECREMENT, got ${direction}`);
  }
  const absCents = Math.abs(deltaCents);
  if (absCents === 0) return null;
  const type = direction === "INCREMENT" ? "ADJUST_INCREMENT" : "ADJUST_DECREMENT";
  const detailsKey = direction === "INCREMENT"
    ? "adjust_increment_activity_details"
    : "adjust_decrement_activity_details";
  const data = await squareFetch(apiBase, accessToken, "/v2/gift-card-activities", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: idempotencyKey,
      gift_card_activity: {
        type,
        location_id: locationId,
        gift_card_id: giftCardId,
        [detailsKey]: {
          amount_money: { amount: absCents, currency: "USD" },
          reason: reason || "OTHER",
        },
      },
    }),
  });
  return data?.gift_card_activity || null;
}

// Split a display name into given/family for Square. Square stores
// them separately, our members.name is a single field. We split on the
// last space; falls back gracefully for single-word names.
export function splitName(full) {
  const s = (full || "").trim();
  if (!s) return { givenName: "", familyName: "" };
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { givenName: parts[0], familyName: "" };
  return {
    givenName: parts.slice(0, -1).join(" "),
    familyName: parts[parts.length - 1],
  };
}
