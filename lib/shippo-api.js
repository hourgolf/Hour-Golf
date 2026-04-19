// Thin REST wrapper for Shippo (https://api.goshippo.com). We don't
// use shippo-node-client to keep the bundle small and avoid SDK
// upgrade churn. Stateless — caller passes credentials per call.

const SHIPPO_BASE = "https://api.goshippo.com";

function buildHeaders(apiKey) {
  return {
    Authorization: `ShippoToken ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function shippoFetch(apiKey, path, init = {}) {
  const r = await fetch(`${SHIPPO_BASE}${path}`, {
    ...init,
    headers: { ...buildHeaders(apiKey), ...(init.headers || {}) },
  });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!r.ok) {
    const msg =
      body?.detail ||
      body?.message ||
      JSON.stringify(body || {}).slice(0, 300) ||
      `Shippo API ${r.status} ${path}`;
    const err = new Error(msg);
    err.status = r.status;
    err.body = body;
    throw err;
  }
  return body;
}

// Aggregate cart line items into a single parcel envelope. For HG-scale
// orders (typically a sleeve of balls + a hat or two), summing weight
// and using the largest single item's dimensions is a reasonable
// approximation that doesn't require multi-parcel logic. If a tenant
// later sells big-and-tall apparel that won't fit one parcel, swap
// this for a packing-algorithm later.
//
// Inputs: array of { weight_oz, length_in, width_in, height_in, quantity }.
// Output: { weight (lb), length, width, height, distance_unit, mass_unit }.
export function buildParcelFromItems(itemsWithDims) {
  let totalOz = 0;
  let maxL = 0;
  let maxW = 0;
  let maxH = 0;
  for (const it of itemsWithDims) {
    const qty = Math.max(1, Number(it.quantity) || 1);
    totalOz += (Number(it.weight_oz) || 0) * qty;
    maxL = Math.max(maxL, Number(it.length_in) || 0);
    maxW = Math.max(maxW, Number(it.width_in) || 0);
    maxH = Math.max(maxH, Number(it.height_in) || 0);
  }
  // Defaults if dimensions weren't set on items: assume a small padded
  // mailer (sleeve of balls / soft goods). USPS Priority Small flat
  // rate-ish footprint.
  if (totalOz === 0) totalOz = 16;
  if (maxL === 0) maxL = 9;
  if (maxW === 0) maxW = 6;
  if (maxH === 0) maxH = 3;
  return {
    weight: Math.max(0.1, Number((totalOz / 16).toFixed(2))),
    length: maxL,
    width: maxW,
    height: maxH,
    distance_unit: "in",
    mass_unit: "lb",
  };
}

// Create a Shippo Shipment with from/to/parcels and return its rates.
// Shippo returns rates inline within ~1-2s for the common carriers
// most tenants will have configured. For slower carriers an async
// poll loop would be needed; not bothering until we hit that case.
export async function createShipmentAndGetRates({
  apiKey, addressFrom, addressTo, parcel,
}) {
  const body = {
    address_from: {
      name: addressFrom.name || "Shop",
      company: addressFrom.company || "",
      street1: addressFrom.street1,
      street2: addressFrom.street2 || "",
      city: addressFrom.city,
      state: addressFrom.state,
      zip: addressFrom.zip,
      country: addressFrom.country || "US",
      phone: addressFrom.phone || "",
      email: addressFrom.email || "",
    },
    address_to: {
      name: addressTo.name,
      street1: addressTo.street1,
      street2: addressTo.street2 || "",
      city: addressTo.city,
      state: addressTo.state,
      zip: addressTo.zip,
      country: addressTo.country || "US",
      phone: addressTo.phone || "",
      email: addressTo.email || "",
    },
    parcels: [parcel],
    async: false,
  };
  const data = await shippoFetch(apiKey, "/shipments/", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return {
    shipment_id: data.object_id,
    rates: data.rates || [],
  };
}

// Buy a label using a rate ID returned from createShipmentAndGetRates.
// Returns tracking_number, tracking_url_provider, label_url. Always
// PDF for predictable rendering server-side.
export async function purchaseLabel({ apiKey, rateId }) {
  const data = await shippoFetch(apiKey, "/transactions/", {
    method: "POST",
    body: JSON.stringify({
      rate: rateId,
      label_file_type: "PDF",
      async: false,
    }),
  });
  if (data.status && data.status !== "SUCCESS") {
    const err = new Error(
      `Label purchase failed: ${(data.messages || []).map((m) => m.text).join("; ") || "unknown"}`
    );
    err.shippoMessages = data.messages || [];
    throw err;
  }
  return {
    transaction_id: data.object_id,
    tracking_number: data.tracking_number || null,
    tracking_url: data.tracking_url_provider || null,
    label_url: data.label_url || null,
    rate: data.rate || null,
  };
}
