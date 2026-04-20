// Shared handler for Stripe webhook events, callable from both:
//   - pages/api/stripe-webhook.js         (legacy single-tenant route, HG only)
//   - pages/api/stripe-webhook/[slug].js  (per-tenant route, Phase 7C)
//
// The caller is responsible for:
//   1. Verifying the Stripe signature (with the correct webhook secret).
//   2. Resolving the tenant_id this event belongs to.
//   3. Initializing a Stripe client with the tenant's secret key.
//
// We scope every email-based member lookup by tenant_id so that a second
// tenant with a coinciding member email can never have the wrong row
// updated. Stripe-ID lookups (stripe_customer_id, stripe_subscription_id)
// remain unscoped because those IDs are globally unique within a single
// Stripe account — which is exactly the isolation we get from per-tenant
// Stripe accounts.

import { SUPABASE_URL } from "./api-helpers";
import { sendWelcomeEmail, sendPaymentReceiptEmail, sendShopOrderNotification } from "./email";
import { getShippoCredentials } from "./shippo-config";
import { purchaseLabel } from "./shippo-api";

export async function handleStripeEvent({ event, stripe, tenantId, serviceKey, portalUrl }) {
  if (!tenantId) {
    throw new Error("handleStripeEvent: tenantId is required");
  }
  if (!serviceKey) {
    throw new Error("handleStripeEvent: serviceKey is required");
  }

  const key = serviceKey;

  switch (event.type) {
    // --- Checkout completed (subscription OR punch pass OR payment setup) ---
    case "checkout.session.completed": {
      const session = event.data.object;

      // --- Payment method setup ---
      if (session.metadata?.type === "payment_setup") {
        const memberEmail = session.metadata.member_email;
        if (memberEmail && session.customer) {
          await fetch(
            `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(memberEmail)}&tenant_id=eq.${tenantId}`,
            {
              method: "PATCH",
              headers: {
                apikey: key, Authorization: `Bearer ${key}`,
                "Content-Type": "application/json",
                Prefer: "return=representation",
              },
              body: JSON.stringify({
                stripe_customer_id: session.customer,
                updated_at: new Date().toISOString(),
              }),
            }
          );
          console.log(`Payment method setup complete for ${memberEmail}`);
        }
        break;
      }

      // --- Guest shop checkout (public /shop route) ---
      // Flip the pending shop_orders rows we wrote pre-checkout to
      // confirmed, capture receipt + card detail from the expanded
      // PaymentIntent so the orders look identical to in-app purchases
      // on the admin + buyer surfaces, and email the buyer a receipt.
      if (session.metadata?.type === "guest_shop") {
        const sessionId = session.id;
        const buyerEmail = (session.customer_email || session.customer_details?.email || "").toLowerCase();

        let receiptUrl = null;
        let receiptNumber = null;
        let cardLast4 = null;
        let cardBrand = null;
        let paymentMethodKind = null;
        try {
          if (session.payment_intent) {
            const pi = await stripe.paymentIntents.retrieve(session.payment_intent, {
              expand: ["latest_charge"],
            });
            const charge = pi?.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
            const card = charge?.payment_method_details?.card || null;
            receiptUrl = charge?.receipt_url || null;
            receiptNumber = charge?.receipt_number || null;
            paymentMethodKind = charge?.payment_method_details?.type || "card";
            cardLast4 = card?.last4 || null;
            cardBrand = card?.brand ? String(card.brand).toUpperCase() : null;
          }
        } catch (e) {
          console.warn("guest_shop: receipt fetch failed (non-fatal):", e.message);
        }

        // Stripe Tax: total_details.amount_tax is in the session's
        // currency cents. We mirror onto every row of the order; the
        // single number lives at the order grain even though we have
        // multi-row line items, since Stripe Tax computes a single
        // tax total per session.
        const taxCents = Number(session.total_details?.amount_tax || 0);
        const taxDollars = taxCents > 0 ? taxCents / 100 : null;

        const updateBody = {
          status: "confirmed",
          stripe_payment_intent_id: session.payment_intent || null,
          receipt_url: receiptUrl,
          receipt_number: receiptNumber,
          payment_method: paymentMethodKind,
          card_last_4: cardLast4,
          card_brand: cardBrand,
          tax_amount: taxDollars,
        };

        // Find pending rows by session id (within tenant) and update.
        // Returning representation lets us count what changed for the
        // log line + email recipient list.
        const updResp = await fetch(
          `${SUPABASE_URL}/rest/v1/shop_orders?tenant_id=eq.${tenantId}&stripe_checkout_session_id=eq.${encodeURIComponent(sessionId)}&status=eq.pending`,
          {
            method: "PATCH",
            headers: {
              apikey: key, Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
              Prefer: "return=representation",
            },
            body: JSON.stringify(updateBody),
          }
        );
        const confirmedRows = updResp.ok ? await updResp.json() : [];
        if (confirmedRows.length === 0) {
          console.log(`guest_shop: no pending rows to confirm for session ${sessionId} (already confirmed or not found)`);
          break;
        }

        console.log(`guest_shop: confirmed ${confirmedRows.length} row(s) for ${buyerEmail} (session ${sessionId})`);

        // Increment quantity_claimed on each item — same lockstep update
        // member-shop.js does. Best-effort; failures are logged.
        for (const row of confirmedRows) {
          try {
            const itResp = await fetch(
              `${SUPABASE_URL}/rest/v1/shop_items?id=eq.${row.item_id}&tenant_id=eq.${tenantId}&select=quantity_claimed`,
              { headers: { apikey: key, Authorization: `Bearer ${key}` } }
            );
            const itRows = itResp.ok ? await itResp.json() : [];
            const cur = Number(itRows[0]?.quantity_claimed || 0);
            await fetch(
              `${SUPABASE_URL}/rest/v1/shop_items?id=eq.${row.item_id}&tenant_id=eq.${tenantId}`,
              {
                method: "PATCH",
                headers: {
                  apikey: key, Authorization: `Bearer ${key}`,
                  "Content-Type": "application/json",
                  Prefer: "return=minimal",
                },
                body: JSON.stringify({ quantity_claimed: cur + Number(row.quantity || 1) }),
              }
            );
          } catch (e) {
            console.warn(`guest_shop: quantity_claimed update failed for item ${row.item_id}:`, e.message);
          }
        }

        // If this was a SHIP order, purchase the Shippo label now.
        // The first row of the session carries the shippo_rate_id +
        // address; we buy one label per session and mirror tracking
        // onto every row of the session for display purposes.
        if (session.metadata?.delivery_method === "ship" && session.metadata?.shippo_rate_id) {
          try {
            const shippo = await getShippoCredentials(tenantId);
            const label = await purchaseLabel({
              apiKey: shippo.apiKey,
              rateId: session.metadata.shippo_rate_id,
            });
            await fetch(
              `${SUPABASE_URL}/rest/v1/shop_orders?tenant_id=eq.${tenantId}&stripe_checkout_session_id=eq.${encodeURIComponent(sessionId)}`,
              {
                method: "PATCH",
                headers: {
                  apikey: key, Authorization: `Bearer ${key}`,
                  "Content-Type": "application/json",
                  Prefer: "return=minimal",
                },
                body: JSON.stringify({
                  shippo_transaction_id: label.transaction_id,
                  tracking_number: label.tracking_number,
                  tracking_url: label.tracking_url,
                  label_url: label.label_url,
                  shipping_status: "label_created",
                  shipping_status_detail: "Label created, awaiting carrier pickup.",
                  shipping_status_updated_at: new Date().toISOString(),
                }),
              }
            );
            console.log(`guest_shop: label purchased for session ${sessionId} (tracking ${label.tracking_number})`);
          } catch (e) {
            console.error(`guest_shop: label purchase failed for session ${sessionId}:`, e.message);
            // Don't fail the webhook — the buyer paid, an admin can
            // re-trigger label purchase manually from the orders view
            // (admin-side endpoint to be added in a future polish).
          }
        }

        // Admin notification email — same helper member-shop.js uses
        // when an in-app purchase happens, with the buyer name
        // suffixed "(guest)" so the operator can tell at a glance
        // this came in via /shop instead of /members/shop. Best
        // effort; failures are logged but don't fail the webhook.
        try {
          const itemIds = [...new Set(confirmedRows.map((r) => r.item_id))];
          const itemMap = {};
          if (itemIds.length > 0) {
            const itResp = await fetch(
              `${SUPABASE_URL}/rest/v1/shop_items?id=in.(${itemIds.join(",")})&tenant_id=eq.${tenantId}&select=id,title`,
              { headers: { apikey: key, Authorization: `Bearer ${key}` } }
            );
            if (itResp.ok) {
              const items = await itResp.json();
              for (const it of items) itemMap[it.id] = it;
            }
          }
          const itemsForEmail = confirmedRows.map((r) => ({
            title: itemMap[r.item_id]?.title || "Item",
            size: r.size,
            quantity: r.quantity,
            lineTotal: Number(r.total || 0),
          }));
          const grandTotal = itemsForEmail.reduce((s, it) => s + it.lineTotal, 0);
          const buyerName = session.metadata?.buyer_name || buyerEmail;
          await sendShopOrderNotification({
            tenantId,
            customerName: `${buyerName} (guest)`,
            customerEmail: buyerEmail,
            items: itemsForEmail,
            total: grandTotal,
            discountPct: 0,
          });
        } catch (e) {
          console.warn("guest_shop: admin notification email failed:", e.message);
        }

        // Buyer-facing receipt: Stripe's hosted Checkout already sends
        // its own receipt to customer_email, so we don't double-send.
        break;
      }

      // --- Punch pass (one-time payment) ---
      if (session.metadata?.type === "punch_pass") {
        const memberEmail = session.metadata.member_email;
        const hours = Number(session.metadata.hours || 0);
        if (!memberEmail || !hours) {
          console.warn("punch_pass checkout missing metadata", session.metadata);
          break;
        }

        const mResp = await fetch(
          `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(memberEmail)}&tenant_id=eq.${tenantId}&select=bonus_hours,bonus_reconciled_month`,
          { headers: { apikey: key, Authorization: `Bearer ${key}` } }
        );
        const mRows = mResp.ok ? await mResp.json() : [];
        const current = Number(mRows[0]?.bonus_hours || 0);
        const reconMonth = mRows[0]?.bonus_reconciled_month;

        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        await fetch(
          `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(memberEmail)}&tenant_id=eq.${tenantId}`,
          {
            method: "PATCH",
            headers: {
              apikey: key, Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
              Prefer: "return=representation",
            },
            body: JSON.stringify({
              bonus_hours: current + hours,
              bonus_reconciled_month: reconMonth || currentMonth,
              stripe_customer_id: session.customer || undefined,
              updated_at: now.toISOString(),
            }),
          }
        );

        console.log(`Punch pass: ${memberEmail} +${hours}h (${current} → ${current + hours})`);
        break;
      }

      // --- Subscription checkout ---
      if (session.mode !== "subscription") break;

      const memberEmail = session.metadata?.member_email;
      const tier = session.metadata?.tier;
      const subscriptionId = session.subscription;

      if (!memberEmail || !tier) {
        console.warn("checkout.session.completed missing metadata", { memberEmail, tier });
        break;
      }

      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      const priceId = sub.items?.data?.[0]?.price?.id || "";

      // Self-heal: if no member row exists for this email yet, create
      // one. Migrated tenants (e.g. AllBooked → HG) sometimes have a
      // Stripe subscription before the member ever logs into the
      // portal — without this insert, the PATCH below silently
      // updated 0 rows and the member stayed Non-Member forever.
      const existingResp = await fetch(
        `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(memberEmail)}&tenant_id=eq.${tenantId}&select=id`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      const existing = existingResp.ok ? await existingResp.json() : [];

      if (existing.length === 0) {
        // Pull whatever name Stripe has on file; fall back to the
        // email's local-part so the column (NOT NULL) gets a
        // reasonable value instead of the raw address.
        let stripeName = null;
        try {
          if (session.customer) {
            const cust = await stripe.customers.retrieve(session.customer);
            stripeName = cust?.name || null;
          }
        } catch (_) { /* fall back below */ }
        const fallbackName = stripeName
          || memberEmail.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
          || memberEmail;

        const insertResp = await fetch(`${SUPABASE_URL}/rest/v1/members`, {
          method: "POST",
          headers: {
            apikey: key, Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: JSON.stringify({
            tenant_id: tenantId,
            email: memberEmail,
            name: fallbackName,
            tier,
            stripe_customer_id: session.customer,
            stripe_subscription_id: subscriptionId,
            stripe_price_id: priceId,
            join_date: new Date().toISOString().slice(0, 10),
            // Member can complete profile (phone, birthday, password)
            // through the portal's Account-setup flow on first login.
          }),
        });
        if (!insertResp.ok) {
          console.error("checkout.session.completed: member insert failed", await insertResp.text());
        } else {
          console.log(`Self-heal: created member row for ${memberEmail} (tier ${tier})`);
        }
      } else {
        await fetch(
          `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(memberEmail)}&tenant_id=eq.${tenantId}`,
          {
            method: "PATCH",
            headers: {
              apikey: key, Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
              Prefer: "return=representation",
            },
            body: JSON.stringify({
              tier,
              stripe_subscription_id: subscriptionId,
              stripe_price_id: priceId,
              stripe_customer_id: session.customer,
              updated_at: new Date().toISOString(),
            }),
          }
        );
      }

      // Get tier config scoped to tenant for welcome email
      let tierConfig = null;
      try {
        const tcResp = await fetch(
          `${SUPABASE_URL}/rest/v1/tier_config?tier=eq.${encodeURIComponent(tier)}&tenant_id=eq.${tenantId}`,
          { headers: { apikey: key, Authorization: `Bearer ${key}` } }
        );
        if (tcResp.ok) {
          const rows = await tcResp.json();
          tierConfig = rows[0] || null;
        }
      } catch (_) {}

      // Get member name for email (tenant already known)
      let memberName = memberEmail;
      try {
        const mResp = await fetch(
          `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(memberEmail)}&tenant_id=eq.${tenantId}&select=name`,
          { headers: { apikey: key, Authorization: `Bearer ${key}` } }
        );
        if (mResp.ok) {
          const rows = await mResp.json();
          if (rows.length) {
            memberName = rows[0].name || memberEmail;
          }
        }
      } catch (_) {}

      try {
        await sendWelcomeEmail({
          tenantId,
          to: memberEmail,
          customerName: memberName,
          tier,
          monthlyFee: tierConfig?.monthly_fee || 0,
          includedHours: tierConfig?.included_hours || 0,
          portalUrl,
        });
      } catch (e) {
        console.error("Welcome email failed:", e);
      }

      console.log(`Member ${memberEmail} subscribed to ${tier}`);
      break;
    }

    // --- Invoice paid (recurring or first payment) ---
    case "invoice.paid": {
      const invoice = event.data.object;
      const stripeCustomerId = invoice.customer;
      const amountPaid = invoice.amount_paid;
      const description = invoice.lines?.data?.[0]?.description || "Membership payment";

      if (!stripeCustomerId || amountPaid <= 0) break;

      // stripe_customer_id is globally unique within a single Stripe account.
      // Belt-and-suspenders: we still scope by tenant_id in case a member row
      // was accidentally seeded with the wrong tenant.
      let memberEmail = null;
      let memberName = null;
      try {
        const mResp = await fetch(
          `${SUPABASE_URL}/rest/v1/members?stripe_customer_id=eq.${encodeURIComponent(stripeCustomerId)}&tenant_id=eq.${tenantId}&select=email,name`,
          { headers: { apikey: key, Authorization: `Bearer ${key}` } }
        );
        if (mResp.ok) {
          const rows = await mResp.json();
          if (rows.length) {
            memberEmail = rows[0].email;
            memberName = rows[0].name;
          }
        }
      } catch (_) {}

      // Self-heal path.
      //
      // checkout.session.completed only carries our `member_email` + `tier`
      // metadata when the subscription was created through our own hosted
      // Checkout flow. Subscriptions created via Stripe Billing directly
      // (Skedda's old channel, Stripe-Dashboard, API subscriptions, etc.)
      // never fire checkout.session.completed with useful metadata — but
      // they DO fire invoice.paid when the first charge settles.
      //
      // Without a fallback here, paid members with no prior members row
      // stay orphaned (admin CRM shows nothing; dashboard won't load).
      // We fix that by backfilling the row from Stripe's own customer +
      // subscription data on the first invoice.paid we see.
      //
      // Lookup by email too (in case the member row exists but with
      // stripe_customer_id not yet attached — e.g. a member signed up
      // through our portal with the same email that Skedda later
      // subscribed).
      if (!memberEmail) {
        try {
          const cust = await stripe.customers.retrieve(stripeCustomerId);
          const custEmail = (cust?.email || "").toLowerCase();
          const custName = cust?.name || null;

          if (custEmail) {
            // Does a row exist with this email (but without the stripe_customer_id)?
            const byEmailResp = await fetch(
              `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(custEmail)}&tenant_id=eq.${tenantId}&select=email,name,id`,
              { headers: { apikey: key, Authorization: `Bearer ${key}` } }
            );
            const byEmailRows = byEmailResp.ok ? await byEmailResp.json() : [];

            // Look up the subscription + tier so we can link correctly.
            let subscriptionId = null;
            let priceId = null;
            let tier = null;
            try {
              if (invoice.subscription) {
                subscriptionId = invoice.subscription;
                const sub = await stripe.subscriptions.retrieve(invoice.subscription);
                priceId = sub.items?.data?.[0]?.price?.id || null;
                if (priceId) {
                  const tcResp = await fetch(
                    `${SUPABASE_URL}/rest/v1/tier_config?stripe_price_id=eq.${encodeURIComponent(priceId)}&tenant_id=eq.${tenantId}&select=tier`,
                    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
                  );
                  if (tcResp.ok) {
                    const tcRows = await tcResp.json();
                    tier = tcRows[0]?.tier || null;
                  }
                }
              }
            } catch (e) {
              console.warn("invoice.paid self-heal: subscription/tier lookup failed:", e.message);
            }

            if (byEmailRows.length > 0) {
              // Attach Stripe IDs + tier to the existing row.
              const existing = byEmailRows[0];
              await fetch(
                `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(existing.email)}&tenant_id=eq.${tenantId}`,
                {
                  method: "PATCH",
                  headers: {
                    apikey: key, Authorization: `Bearer ${key}`,
                    "Content-Type": "application/json",
                    Prefer: "return=minimal",
                  },
                  body: JSON.stringify({
                    stripe_customer_id: stripeCustomerId,
                    stripe_subscription_id: subscriptionId || undefined,
                    stripe_price_id: priceId || undefined,
                    tier: tier || undefined,
                    updated_at: new Date().toISOString(),
                  }),
                }
              );
              memberEmail = existing.email;
              memberName = existing.name;
              console.log(`invoice.paid self-heal: linked Stripe to existing member ${memberEmail} (tier ${tier || "unchanged"})`);
            } else {
              // Create a fresh members row. Name from Stripe falls back to
              // a titlecased email local-part so the NOT NULL column gets
              // something reasonable instead of the raw address.
              const fallbackName =
                custName ||
                custEmail.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) ||
                custEmail;
              const insertResp = await fetch(`${SUPABASE_URL}/rest/v1/members`, {
                method: "POST",
                headers: {
                  apikey: key, Authorization: `Bearer ${key}`,
                  "Content-Type": "application/json",
                  Prefer: "return=representation",
                },
                body: JSON.stringify({
                  tenant_id: tenantId,
                  email: custEmail,
                  name: fallbackName,
                  tier: tier || "Non-Member",
                  stripe_customer_id: stripeCustomerId,
                  stripe_subscription_id: subscriptionId,
                  stripe_price_id: priceId,
                  join_date: new Date().toISOString().slice(0, 10),
                }),
              });
              if (insertResp.ok) {
                memberEmail = custEmail;
                memberName = fallbackName;
                console.log(`invoice.paid self-heal: created member row for ${memberEmail} (tier ${tier || "Non-Member"})`);
              } else {
                console.error("invoice.paid self-heal: insert failed", await insertResp.text());
              }
            }
          }
        } catch (e) {
          console.error("invoice.paid self-heal: customer retrieve failed:", e.message);
        }
      }

      if (!memberEmail) {
        console.warn("invoice.paid: could not find or create member for customer", stripeCustomerId, "tenant", tenantId);
        break;
      }

      const paymentIntentId = invoice.payment_intent;
      if (paymentIntentId) {
        try {
          const dupResp = await fetch(
            `${SUPABASE_URL}/rest/v1/payments?stripe_payment_intent_id=eq.${encodeURIComponent(paymentIntentId)}&tenant_id=eq.${tenantId}&select=id`,
            { headers: { apikey: key, Authorization: `Bearer ${key}` } }
          );
          if (dupResp.ok) {
            const dups = await dupResp.json();
            if (dups.length > 0) {
              console.log("invoice.paid: duplicate, skipping", paymentIntentId);
              break;
            }
          }
        } catch (_) {}
      }

      const billingMonth = new Date(invoice.period_start * 1000).toISOString();
      await fetch(`${SUPABASE_URL}/rest/v1/payments`, {
        method: "POST",
        headers: {
          apikey: key, Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tenant_id: tenantId,
          member_email: memberEmail,
          billing_month: billingMonth,
          amount_cents: amountPaid,
          stripe_payment_intent_id: paymentIntentId || `inv_${invoice.id}`,
          status: "succeeded",
          description,
        }),
      });

      try {
        await sendPaymentReceiptEmail({
          tenantId,
          to: memberEmail,
          customerName: memberName || memberEmail,
          amount: amountPaid,
          description,
          date: new Date(invoice.created * 1000).toLocaleDateString("en-US", {
            month: "long", day: "numeric", year: "numeric",
          }),
          portalUrl,
        });
      } catch (e) {
        console.error("Payment receipt email failed:", e);
      }

      console.log(`Payment recorded for ${memberEmail}: $${(amountPaid / 100).toFixed(2)}`);
      break;
    }

    // --- Subscription updated (tier change) ---
    case "customer.subscription.updated": {
      const sub = event.data.object;
      const newPriceId = sub.items?.data?.[0]?.price?.id;
      const stripeCustomerId = sub.customer;

      if (!newPriceId || !stripeCustomerId) break;

      // Look up tier by price ID within this tenant
      let newTier = null;
      try {
        const tcResp = await fetch(
          `${SUPABASE_URL}/rest/v1/tier_config?stripe_price_id=eq.${encodeURIComponent(newPriceId)}&tenant_id=eq.${tenantId}&select=tier`,
          { headers: { apikey: key, Authorization: `Bearer ${key}` } }
        );
        if (tcResp.ok) {
          const rows = await tcResp.json();
          if (rows.length) newTier = rows[0].tier;
        }
      } catch (_) {}

      if (newTier) {
        await fetch(
          `${SUPABASE_URL}/rest/v1/members?stripe_customer_id=eq.${encodeURIComponent(stripeCustomerId)}&tenant_id=eq.${tenantId}`,
          {
            method: "PATCH",
            headers: {
              apikey: key, Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
              Prefer: "return=representation",
            },
            body: JSON.stringify({
              tier: newTier,
              stripe_price_id: newPriceId,
              updated_at: new Date().toISOString(),
            }),
          }
        );
        console.log(`Subscription updated for customer ${stripeCustomerId}: tier -> ${newTier}`);
      }
      break;
    }

    // --- Subscription cancelled ---
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      const subscriptionId = sub.id;

      await fetch(
        `${SUPABASE_URL}/rest/v1/members?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}&tenant_id=eq.${tenantId}`,
        {
          method: "PATCH",
          headers: {
            apikey: key, Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: JSON.stringify({
            tier: "Non-Member",
            stripe_subscription_id: null,
            stripe_price_id: null,
            updated_at: new Date().toISOString(),
          }),
        }
      );
      console.log(`Subscription ${subscriptionId} deleted, member reverted to Non-Member`);
      break;
    }

    // --- Payment failed ---
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      console.warn(`Payment failed for customer ${invoice.customer}: ${invoice.id}`);
      break;
    }

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }
}

// Read the raw request body. Stripe signature verification requires the
// unparsed bytes, so API routes that delegate to this module must set
// `export const config = { api: { bodyParser: false } };`.
export async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}
