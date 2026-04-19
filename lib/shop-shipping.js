// Customer-facing shipping policy: flat $10 unless the order subtotal
// hits the free-shipping threshold. The merchant absorbs the actual
// carrier cost (Shippo charges them whatever the cheapest rate
// returns); this module keeps the customer pricing in one place so
// /shop and /members/shop stay in lockstep.

export const FLAT_SHIPPING_CENTS = 1000;        // $10.00
export const FREE_SHIPPING_THRESHOLD_CENTS = 10000; // $100.00

export function customerShippingChargeCents(subtotalCents) {
  if (subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS) return 0;
  return FLAT_SHIPPING_CENTS;
}

export function freeShippingThresholdLabel() {
  return `$${(FREE_SHIPPING_THRESHOLD_CENTS / 100).toFixed(0)}`;
}
