// TEMPORARY Phase 7A smoke-test endpoint.
//
// Exercises lib/stripe-config.js by loading Hour Golf's stripe config (once
// seeded via the SQL template) and constructing a Stripe client. Returns a
// small status payload — never the secret key.
//
// DELETE THIS FILE AFTER VERIFICATION. It is not part of Phase 7 or any
// downstream phase and should not reach the next session.

import { loadStripeConfig, getStripeClient } from "../../lib/stripe-config";

const HOURGOLF_TENANT_ID = "11111111-1111-4111-8111-111111111111";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");

  try {
    const cfg = await loadStripeConfig(HOURGOLF_TENANT_ID);
    if (!cfg) {
      return res.status(200).json({
        ok: false,
        stage: "loadStripeConfig",
        message:
          "No tenant_stripe_config row for Hour Golf yet. Run the seed INSERT in Supabase SQL editor, then retry.",
      });
    }
    const client = await getStripeClient(HOURGOLF_TENANT_ID);
    // Don't call the Stripe API here — just prove the client constructed.
    // A real Stripe call would cost time / potentially hit rate limits.
    return res.status(200).json({
      ok: true,
      mode: cfg.mode,
      enabled: cfg.enabled,
      has_webhook_secret: !!cfg.webhook_secret,
      publishable_key_prefix: cfg.publishable_key?.slice(0, 7), // "pk_live" / "pk_test"
      secret_key_prefix: cfg.secret_key?.slice(0, 7),           // "sk_live" / "sk_test"
      stripe_client_ready: !!client,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
}
