// Thin REST wrapper for the Square API. We call Square directly rather
// than depending on the `square` Node SDK so the bundle stays small and
// we aren't coupled to the SDK's upgrade cadence. All methods here are
// stateless — the caller passes credentials, we return parsed JSON.
//
// Square REST docs: https://developer.squareup.com/reference/square
// Error shape: { errors: [{ code, detail, field? }] }

const SQUARE_VERSION = "2025-01-23";

function buildHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Square-Version": SQUARE_VERSION,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function squareFetch(apiBase, accessToken, path, init = {}) {
  const url = `${apiBase}${path}`;
  const resp = await fetch(url, {
    ...init,
    headers: { ...buildHeaders(accessToken), ...(init.headers || {}) },
  });
  const text = await resp.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!resp.ok) {
    const err = new Error(
      body?.errors?.[0]?.detail ||
      body?.errors?.[0]?.code ||
      `Square API ${resp.status} ${path}`
    );
    err.status = resp.status;
    err.errors = body?.errors || [];
    err.body = body;
    throw err;
  }
  return body;
}

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
