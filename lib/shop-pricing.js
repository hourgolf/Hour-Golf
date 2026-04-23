// Shared pricing helpers for the pro shop. Used by admin list,
// MemberShop, and pages/shop.js so the "on sale" logic never drifts
// between surfaces.
//
// An item is on sale when:
//   * compare_at_price is set
//   * compare_at_price > price (the usual "was $80 now $60" case)
//   * sale_ends_at is null OR in the future
//
// If compare_at_price <= price (operator entered them wrong, or sale
// has been "faked") we return false — refuse to show a fake discount.

export function isOnSale(item, now = new Date()) {
  if (!item) return false;
  const compare = Number(item.compare_at_price || 0);
  const price = Number(item.price || 0);
  if (!compare || compare <= price) return false;
  if (item.sale_ends_at) {
    const ends = new Date(item.sale_ends_at);
    if (!isNaN(ends) && ends.getTime() <= now.getTime()) return false;
  }
  return true;
}

// Percent off, rounded to int. Returns 0 when not on sale so callers
// can render `{pct > 0 && <chip>-{pct}%</chip>}` inline.
export function saleDiscountPct(item) {
  if (!isOnSale(item)) return 0;
  const compare = Number(item.compare_at_price);
  const price = Number(item.price);
  if (!compare) return 0;
  return Math.round(((compare - price) / compare) * 100);
}
