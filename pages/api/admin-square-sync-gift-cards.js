// POST /api/admin-square-sync-gift-cards
//
// Phase C1-A: reconcile every linked member's shop_credit_balance with
// a Square Gift Card so Square Register auto-applies the balance when
// the member is scanned.
//
// Per member (only those with square_customer_id already set):
//   - shop_credit_balance == 0 AND no gift card: skip (no point creating
//     empty cards)
//   - shop_credit_balance > 0 AND no gift card: create + link to
//     customer + ACTIVATE with current balance
//   - has gift card: fetch Square's current balance, compute delta,
//     ADJUST_INCREMENT or ADJUST_DECREMENT to match our value
//
// Dual auth like the other Square admin endpoints (platform admin via
// body.tenant_id or tenant admin via x-tenant-id header). Dry-run
// support so the operator can see the planned activity before any
// Square writes.
//
// Rate-limit safety: 300ms sleep between members, 60s max duration.

import { verifyAdmin, SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";
import { verifyPlatformAdmin } from "../../lib/platform-auth";
import { getSquareCredentials } from "../../lib/square-config";
import {
  createDigitalGiftCard,
  linkGiftCardToCustomer,
  activateGiftCard,
  getGiftCardById,
  adjustGiftCard,
  sleep,
} from "../../lib/square-api";

export const config = { maxDuration: 60 };

const INTER_MEMBER_DELAY_MS = 300;

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function toCents(dollars) {
  return Math.round(Number(dollars || 0) * 100);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  let tenantId;
  const platformAuth = await verifyPlatformAdmin(req);
  if (platformAuth?.user) {
    const requested = (req.body || {}).tenant_id;
    if (!isUuid(requested)) {
      return res.status(400).json({ error: "tenant_id required in body for platform-admin calls" });
    }
    tenantId = requested;
  } else {
    const adminAuth = await verifyAdmin(req);
    if (!adminAuth.user) {
      return res.status(401).json({ error: "Unauthorized", detail: adminAuth.reason });
    }
    tenantId = adminAuth.tenantId;
  }

  const dryRun = !!(req.body || {}).dryRun;

  const serviceKey = getServiceKey();
  if (!serviceKey) return res.status(500).json({ error: "Server configuration error" });

  let square;
  try {
    square = await getSquareCredentials(tenantId);
  } catch (e) {
    return res.status(400).json({ error: "Square not configured", detail: e.message });
  }

  // Fetch members that have at least been linked to Square.
  const memResp = await fetch(
    `${SUPABASE_URL}/rest/v1/members?tenant_id=eq.${tenantId}&square_customer_id=not.is.null&tier=neq.Non-Member&select=id,email,name,shop_credit_balance,square_customer_id,square_gift_card_id`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  if (!memResp.ok) return res.status(500).json({ error: "Member lookup failed" });
  const members = await memResp.json();

  const report = [];
  const summary = {
    totalLinked: members.length,
    skippedZeroBalance: 0,
    cardsCreated: 0,
    adjustedIncrement: 0,
    adjustedDecrement: 0,
    alreadyInSync: 0,
    errors: 0,
    dryRun,
  };

  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    if (i > 0) await sleep(INTER_MEMBER_DELAY_MS);

    const ourBalanceCents = toCents(m.shop_credit_balance);

    // Skip members with zero balance AND no card yet — no point creating
    // a dead-weight card on Square's side.
    if (ourBalanceCents === 0 && !m.square_gift_card_id) {
      summary.skippedZeroBalance += 1;
      report.push({ memberId: m.id, email: m.email, action: "skipped_zero_balance" });
      continue;
    }

    try {
      if (!m.square_gift_card_id) {
        // Create + link + activate in one logical step.
        if (dryRun) {
          summary.cardsCreated += 1;
          report.push({ memberId: m.id, email: m.email, action: "would_create_and_activate", amountCents: ourBalanceCents });
          continue;
        }
        const card = await createDigitalGiftCard({
          apiBase: square.apiBase,
          accessToken: square.accessToken,
          locationId: square.locationId,
          idempotencyKey: `gc-create-${m.id}`,
        });
        if (!card?.id) throw new Error("gift card create returned no id");
        await linkGiftCardToCustomer({
          apiBase: square.apiBase,
          accessToken: square.accessToken,
          giftCardId: card.id,
          customerId: m.square_customer_id,
        });
        if (ourBalanceCents > 0) {
          await activateGiftCard({
            apiBase: square.apiBase,
            accessToken: square.accessToken,
            locationId: square.locationId,
            giftCardId: card.id,
            amountCents: ourBalanceCents,
            idempotencyKey: `gc-activate-${m.id}`,
          });
        }
        // Persist the card id on our side BEFORE reporting success.
        await fetch(
          `${SUPABASE_URL}/rest/v1/members?id=eq.${encodeURIComponent(m.id)}`,
          {
            method: "PATCH",
            headers: {
              apikey: serviceKey,
              Authorization: `Bearer ${serviceKey}`,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            body: JSON.stringify({ square_gift_card_id: card.id }),
          }
        );
        summary.cardsCreated += 1;
        report.push({
          memberId: m.id,
          email: m.email,
          action: "created_and_activated",
          giftCardId: card.id,
          amountCents: ourBalanceCents,
        });
        continue;
      }

      // Card already exists — fetch Square's current balance and
      // reconcile.
      const card = await getGiftCardById({
        apiBase: square.apiBase,
        accessToken: square.accessToken,
        giftCardId: m.square_gift_card_id,
      });
      const squareBalanceCents = Number(card?.balance_money?.amount || 0);
      const delta = ourBalanceCents - squareBalanceCents;

      if (delta === 0) {
        summary.alreadyInSync += 1;
        report.push({
          memberId: m.id,
          email: m.email,
          action: "in_sync",
          balanceCents: ourBalanceCents,
          giftCardId: m.square_gift_card_id,
        });
        continue;
      }

      if (dryRun) {
        if (delta > 0) summary.adjustedIncrement += 1;
        else summary.adjustedDecrement += 1;
        report.push({
          memberId: m.id,
          email: m.email,
          action: delta > 0 ? "would_increment" : "would_decrement",
          deltaCents: delta,
          ourBalanceCents,
          squareBalanceCents,
          giftCardId: m.square_gift_card_id,
        });
        continue;
      }

      await adjustGiftCard({
        apiBase: square.apiBase,
        accessToken: square.accessToken,
        locationId: square.locationId,
        giftCardId: m.square_gift_card_id,
        deltaCents: delta,
        direction: delta > 0 ? "INCREMENT" : "DECREMENT",
        reason: "OTHER",
        idempotencyKey: `gc-sync-${m.id}-${Date.now()}`,
      });
      if (delta > 0) summary.adjustedIncrement += 1;
      else summary.adjustedDecrement += 1;
      report.push({
        memberId: m.id,
        email: m.email,
        action: delta > 0 ? "incremented" : "decremented",
        deltaCents: delta,
        newBalanceCents: ourBalanceCents,
        giftCardId: m.square_gift_card_id,
      });
    } catch (e) {
      summary.errors += 1;
      report.push({
        memberId: m.id,
        email: m.email,
        action: "error",
        detail: e.message?.slice(0, 500) || "unknown",
      });
    }
  }

  return res.status(200).json({ summary, report });
}
