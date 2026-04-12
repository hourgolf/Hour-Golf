import Stripe from "stripe";
import { SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";
import { sendWelcomeEmail, sendPaymentReceiptEmail } from "../../lib/email";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Disable Next.js body parsing — Stripe signature verification needs the raw body
export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    console.error("Missing stripe-signature or STRIPE_WEBHOOK_SECRET");
    return res.status(400).json({ error: "Missing signature" });
  }

  let event;
  try {
    const buf = await getRawBody(req);
    event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
  } catch (e) {
    console.error("Webhook signature verification failed:", e.message);
    return res.status(400).json({ error: "Invalid signature" });
  }

  console.log(`Stripe webhook: ${event.type} (${event.id})`);

  try {
    switch (event.type) {
      // --- Checkout completed (subscription OR punch pass) ---
      case "checkout.session.completed": {
        const session = event.data.object;
        // --- Payment method setup ---
        if (session.metadata?.type === "payment_setup") {
          const memberEmail = session.metadata.member_email;
          if (memberEmail && session.customer) {
            await fetch(
              `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(memberEmail)}`,
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


        // --- Punch pass (one-time payment) ---
        if (session.metadata?.type === "punch_pass") {
          const memberEmail = session.metadata.member_email;
          const hours = Number(session.metadata.hours || 0);
          if (!memberEmail || !hours) {
            console.warn("punch_pass checkout missing metadata", session.metadata);
            break;
          }

          // Get current bonus_hours
          const mResp = await fetch(
            `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(memberEmail)}&select=bonus_hours,bonus_reconciled_month`,
            { headers: { apikey: key, Authorization: `Bearer ${key}` } }
          );
          const mRows = mResp.ok ? await mResp.json() : [];
          const current = Number(mRows[0]?.bonus_hours || 0);
          const reconMonth = mRows[0]?.bonus_reconciled_month;

          // Increment bonus_hours
          const now = new Date();
          const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
          await fetch(
            `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(memberEmail)}`,
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

        // Get subscription details for price ID
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = sub.items?.data?.[0]?.price?.id || "";

        // Update member: tier + subscription IDs
        await fetch(
          `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(memberEmail)}`,
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

        // Get tier config for welcome email
        let tierConfig = null;
        try {
          const tcResp = await fetch(
            `${SUPABASE_URL}/rest/v1/tier_config?tier=eq.${encodeURIComponent(tier)}`,
            { headers: { apikey: key, Authorization: `Bearer ${key}` } }
          );
          if (tcResp.ok) {
            const rows = await tcResp.json();
            tierConfig = rows[0] || null;
          }
        } catch (_) {}

        // Get member name for email
        let memberName = memberEmail;
        try {
          const mResp = await fetch(
            `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(memberEmail)}&select=name`,
            { headers: { apikey: key, Authorization: `Bearer ${key}` } }
          );
          if (mResp.ok) {
            const rows = await mResp.json();
            if (rows.length) memberName = rows[0].name || memberEmail;
          }
        } catch (_) {}

        // Send welcome email
        sendWelcomeEmail({
          to: memberEmail,
          customerName: memberName,
          tier,
          monthlyFee: tierConfig?.monthly_fee || 0,
          includedHours: tierConfig?.included_hours || 0,
        }).catch(() => {});

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

        // Find member by stripe_customer_id
        let memberEmail = null;
        let memberName = null;
        try {
          const mResp = await fetch(
            `${SUPABASE_URL}/rest/v1/members?stripe_customer_id=eq.${encodeURIComponent(stripeCustomerId)}&select=email,name`,
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

        if (!memberEmail) {
          console.warn("invoice.paid: could not find member for customer", stripeCustomerId);
          break;
        }

        // Check for duplicate payment (idempotency)
        const paymentIntentId = invoice.payment_intent;
        if (paymentIntentId) {
          try {
            const dupResp = await fetch(
              `${SUPABASE_URL}/rest/v1/payments?stripe_payment_intent_id=eq.${encodeURIComponent(paymentIntentId)}&select=id`,
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

        // Record payment
        const billingMonth = new Date(invoice.period_start * 1000).toISOString();
        await fetch(`${SUPABASE_URL}/rest/v1/payments`, {
          method: "POST",
          headers: {
            apikey: key, Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            member_email: memberEmail,
            billing_month: billingMonth,
            amount_cents: amountPaid,
            stripe_payment_intent_id: paymentIntentId || `inv_${invoice.id}`,
            status: "succeeded",
            description,
          }),
        });

        // Send receipt email
        sendPaymentReceiptEmail({
          to: memberEmail,
          customerName: memberName || memberEmail,
          amount: amountPaid,
          description,
          date: new Date(invoice.created * 1000).toLocaleDateString("en-US", {
            month: "long", day: "numeric", year: "numeric",
          }),
        }).catch(() => {});

        console.log(`Payment recorded for ${memberEmail}: $${(amountPaid / 100).toFixed(2)}`);
        break;
      }

      // --- Subscription updated (tier change) ---
      case "customer.subscription.updated": {
        const sub = event.data.object;
        const newPriceId = sub.items?.data?.[0]?.price?.id;
        const stripeCustomerId = sub.customer;

        if (!newPriceId || !stripeCustomerId) break;

        // Look up tier by price ID
        let newTier = null;
        try {
          const tcResp = await fetch(
            `${SUPABASE_URL}/rest/v1/tier_config?stripe_price_id=eq.${encodeURIComponent(newPriceId)}&select=tier`,
            { headers: { apikey: key, Authorization: `Bearer ${key}` } }
          );
          if (tcResp.ok) {
            const rows = await tcResp.json();
            if (rows.length) newTier = rows[0].tier;
          }
        } catch (_) {}

        if (newTier) {
          await fetch(
            `${SUPABASE_URL}/rest/v1/members?stripe_customer_id=eq.${encodeURIComponent(stripeCustomerId)}`,
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

        // Revert member to Non-Member
        await fetch(
          `${SUPABASE_URL}/rest/v1/members?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}`,
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
  } catch (e) {
    // Always return 200 to Stripe even on internal errors
    console.error(`Webhook processing error for ${event.type}:`, e);
  }

  return res.status(200).json({ received: true });
}
