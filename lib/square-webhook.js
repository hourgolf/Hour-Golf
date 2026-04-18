// Square webhook signature verification + shared handler logic.
//
// Signature protocol (Square docs):
//   header name:  x-square-hmacsha256-signature
//   value:        base64(HMAC_SHA256(signing_key, notification_url + raw_body))
// where notification_url is the exact URL Square is POSTing to
// (scheme + host + path + query if any).

import crypto from "crypto";
import { SUPABASE_URL } from "./api-helpers";

export function verifySquareSignature({ signingKey, notificationUrl, rawBody, headerValue }) {
  if (!signingKey || !headerValue) return false;
  const payload = `${notificationUrl}${rawBody.toString("utf8")}`;
  const expected = crypto
    .createHmac("sha256", signingKey)
    .update(payload)
    .digest("base64");
  // timingSafeEqual requires equal-length buffers.
  const a = Buffer.from(expected);
  const b = Buffer.from(headerValue);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Idempotently record a completed Square payment in the shared payments
// table. Returns { recorded: boolean, reason?: string }.
//
// Writes are keyed by (tenant_id, square_payment_id) — a retried
// webhook delivery is a no-op.
export async function recordSquarePayment({
  serviceKey, tenantId, squarePaymentId, memberEmail, amountCents, description, occurredAtISO,
  receiptUrl, receiptNumber, paymentMethod, cardLast4, cardBrand,
}) {
  // Dedup check.
  const dupResp = await fetch(
    `${SUPABASE_URL}/rest/v1/payments?tenant_id=eq.${tenantId}&square_payment_id=eq.${encodeURIComponent(squarePaymentId)}&select=id`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  if (dupResp.ok) {
    const dups = await dupResp.json();
    if (dups.length > 0) return { recorded: false, reason: "duplicate" };
  }

  const billingMonth = occurredAtISO || new Date().toISOString();

  const insert = await fetch(`${SUPABASE_URL}/rest/v1/payments`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      tenant_id: tenantId,
      member_email: memberEmail,
      billing_month: billingMonth,
      amount_cents: amountCents,
      source: "square_pos",
      square_payment_id: squarePaymentId,
      status: "succeeded",
      description: description || "In-store Square purchase",
      receipt_url: receiptUrl || null,
      receipt_number: receiptNumber || null,
      payment_method: paymentMethod || null,
      card_last_4: cardLast4 || null,
      card_brand: cardBrand || null,
    }),
  });

  if (!insert.ok) {
    const text = await insert.text();
    throw new Error(`payments insert ${insert.status}: ${text}`);
  }
  return { recorded: true };
}

// Dispatch Square webhook events. Only COMPLETED payment.updated events
// result in a recorded row. Idempotency is enforced at the DB layer via
// the (tenant_id, square_payment_id) unique index we added in the
// 20260418140000 migration.
export async function handleSquareEvent({ event, tenantId, serviceKey }) {
  const type = event?.type;
  switch (type) {
    case "payment.updated":
    case "payment.created": {
      const payment = event?.data?.object?.payment;
      if (!payment) return { handled: false, reason: "missing payment payload" };
      if (payment.status !== "COMPLETED") {
        return { handled: false, reason: `payment status is ${payment.status}, not COMPLETED` };
      }
      const customerId = payment.customer_id;
      if (!customerId) return { handled: false, reason: "no customer_id on payment" };

      const memberResp = await fetch(
        `${SUPABASE_URL}/rest/v1/members?tenant_id=eq.${tenantId}&square_customer_id=eq.${encodeURIComponent(customerId)}&select=email,name`,
        { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
      );
      if (!memberResp.ok) return { handled: false, reason: `member lookup ${memberResp.status}` };
      const rows = await memberResp.json();
      const member = rows[0];
      if (!member) {
        // Payment for a Square customer that isn't linked to any of our
        // members (walk-in, not yet backfilled, etc.). Not an error.
        return { handled: false, reason: "no matching member for square_customer_id" };
      }

      const amountCents = payment.amount_money?.amount;
      if (typeof amountCents !== "number" || amountCents <= 0) {
        return { handled: false, reason: "amount missing or non-positive" };
      }

      const occurredAtISO = payment.created_at || null;

      // Prefer the human-readable Square receipt number for the
      // description when the merchant didn't set a note at checkout.
      // Falls back through note -> receipt number -> generic label.
      const note = payment.note ? String(payment.note).trim() : "";
      const receiptNumber = payment.receipt_number || null;
      let description;
      if (note) description = `In-store: ${note.slice(0, 200)}`;
      else if (receiptNumber) description = `In-store purchase #${receiptNumber}`;
      else description = "In-store Square purchase";

      const sourceType = payment.source_type ? String(payment.source_type).toLowerCase() : null;
      const cardLast4 = payment.card_details?.card?.last_4 || null;
      const cardBrand = payment.card_details?.card?.card_brand || null;

      const result = await recordSquarePayment({
        serviceKey,
        tenantId,
        squarePaymentId: payment.id,
        memberEmail: member.email,
        amountCents,
        description,
        occurredAtISO,
        receiptUrl: payment.receipt_url || null,
        receiptNumber,
        paymentMethod: sourceType,
        cardLast4,
        cardBrand,
      });
      return { handled: true, ...result };
    }
    case "refund.created":
    case "refund.updated": {
      const refund = event?.data?.object?.refund;
      if (!refund) return { handled: false, reason: "missing refund payload" };
      if (refund.status !== "COMPLETED") {
        return { handled: false, reason: `refund status is ${refund.status}, not COMPLETED` };
      }
      const squarePaymentId = refund.payment_id;
      const amount = refund.amount_money?.amount;
      if (!squarePaymentId) return { handled: false, reason: "no payment_id on refund" };
      if (typeof amount !== "number" || amount <= 0) {
        return { handled: false, reason: "refund amount missing or non-positive" };
      }

      // Idempotency — Square retries are expected. External unique index
      // on (tenant_id, external_refund_id) backstops this, but an
      // explicit check lets us skip the subsequent UPDATE round-trip.
      const dup = await fetch(
        `${SUPABASE_URL}/rest/v1/refunds?tenant_id=eq.${tenantId}&external_refund_id=eq.${encodeURIComponent(refund.id)}&select=id`,
        { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
      );
      if (dup.ok) {
        const rows = await dup.json();
        if (rows.length > 0) return { handled: false, reason: "refund already recorded" };
      }

      // Find the original payment by square_payment_id (within tenant).
      const payResp = await fetch(
        `${SUPABASE_URL}/rest/v1/payments?tenant_id=eq.${tenantId}&square_payment_id=eq.${encodeURIComponent(squarePaymentId)}&select=id,amount_cents,refunded_cents`,
        { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
      );
      if (!payResp.ok) return { handled: false, reason: `payment lookup ${payResp.status}` };
      const payRows = await payResp.json();
      const payment = payRows[0];
      // If the original payment isn't in our DB (e.g. refund of a walk-in
      // sale that never linked to a member), we still record the refund
      // row for audit purposes but skip the payments UPDATE.
      const paymentUuid = payment?.id || null;

      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/refunds`, {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          tenant_id: tenantId,
          payment_id: paymentUuid,
          source: "square_pos",
          external_refund_id: refund.id,
          amount_cents: amount,
          status: "completed",
          reason: refund.reason ? String(refund.reason).slice(0, 200) : null,
        }),
      });
      // Unique index collision means a concurrent webhook delivery beat
      // us to the insert. Safe — we return idempotent and skip the
      // payments update to avoid double-decrementing.
      if (insertRes.status === 409) {
        return { handled: false, reason: "refund already recorded (race)" };
      }
      if (!insertRes.ok) {
        throw new Error(`refund insert ${insertRes.status}: ${await insertRes.text()}`);
      }

      if (payment) {
        const currentRefunded = Number(payment.refunded_cents || 0);
        // Cap at the original amount — you can't refund more than you
        // took. If Square's sums ever disagree with ours, the cap
        // ensures loyalty aggregation never goes negative.
        const newRefunded = Math.min(
          currentRefunded + amount,
          Number(payment.amount_cents || 0)
        );
        await fetch(
          `${SUPABASE_URL}/rest/v1/payments?id=eq.${payment.id}`,
          {
            method: "PATCH",
            headers: {
              apikey: serviceKey,
              Authorization: `Bearer ${serviceKey}`,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            body: JSON.stringify({ refunded_cents: newRefunded }),
          }
        );
      }

      return { handled: true, recorded: true };
    }
    default:
      return { handled: false, reason: `unhandled event type: ${type}` };
  }
}
