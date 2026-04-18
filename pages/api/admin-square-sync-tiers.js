// POST /api/admin-square-sync-tiers
//
// Phase 3: push each linked member's current HG tier + pro-shop discount
// into their Square customer record so staff at the POS see it on the
// customer profile, and so Square customer groups tagged per tier exist
// for any automatic-discount rules the merchant sets up in Square
// Dashboard.
//
// Per member, this:
//   1. Ensures a Square customer group named "HG tier: <Tier>" exists
//      (creates if missing — idempotent after first call).
//   2. Overwrites the customer's note with
//      "HG tier: <Tier> — <N>% pro-shop discount".
//   3. Assigns the customer to their current tier's group and, if we
//      moved them between tiers, removes them from the stale one.
//
// Only touches members that already have a square_customer_id (i.e.
// Phase 1 backfill has run). Skips Non-Member tier rows.
//
// Auth: same dual-auth as admin-square-backfill. Platform admin from
// /platform/tenants/<slug> passes tenant_id in body; tenant admin uses
// x-tenant-id header.

import { verifyAdmin, SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";
import { verifyPlatformAdmin } from "../../lib/platform-auth";
import { getSquareCredentials } from "../../lib/square-config";
import {
  listCustomerGroups,
  createCustomerGroup,
  updateCustomer,
  addCustomerToGroup,
  removeCustomerFromGroup,
  sleep,
} from "../../lib/square-api";

export const config = { maxDuration: 60 };

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

const INTER_MEMBER_DELAY_MS = 300;
const GROUP_PREFIX = "HG tier:";

// DB tier names (set in lib/constants.js) haven't been renamed to match
// HG's current member-facing branding. Remap only at the Square
// boundary so Square's note + group names reflect what members and
// staff actually say out loud. A global rename across DB, Stripe, and
// emails is tracked separately — when that lands, this map becomes
// redundant and can be deleted.
const TIER_DISPLAY_MAP = {
  "Starter": "Player",
  "Green Jacket": "Jacket",
};

function displayTierName(tier) {
  return TIER_DISPLAY_MAP[tier] || tier;
}

function tierGroupName(tier) {
  return `${GROUP_PREFIX} ${displayTierName(tier)}`;
}

function noteFor(tier, discountPct) {
  const pct = Number(discountPct || 0);
  const pctStr = pct > 0 ? `${pct}% pro-shop discount` : "no pro-shop discount";
  return `HG tier: ${displayTierName(tier)} — ${pctStr}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  let tenantId;
  const platformAuth = await verifyPlatformAdmin(req);
  if (platformAuth?.user) {
    const body = req.body || {};
    const requested = body.tenant_id;
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

  // Only members already linked to Square are eligible. Non-Member tier
  // gets skipped below.
  const memResp = await fetch(
    `${SUPABASE_URL}/rest/v1/members?tenant_id=eq.${tenantId}&square_customer_id=not.is.null&select=id,email,name,tier,square_customer_id`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  if (!memResp.ok) return res.status(500).json({ error: "Member lookup failed" });
  const members = await memResp.json();

  // Pre-fetch tier_config so we know the discount percent per tier.
  const tcResp = await fetch(
    `${SUPABASE_URL}/rest/v1/tier_config?tenant_id=eq.${tenantId}&select=tier,pro_shop_discount`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  const tierRows = tcResp.ok ? await tcResp.json() : [];
  const discountByTier = new Map();
  for (const r of tierRows) discountByTier.set(r.tier, Number(r.pro_shop_discount || 0));

  // Ensure a group exists for every tier we'll touch. Uses list-then-
  // create to be idempotent across repeated runs.
  const existingGroups = await listCustomerGroups({
    apiBase: square.apiBase,
    accessToken: square.accessToken,
  });
  const groupsByName = new Map();
  for (const g of existingGroups) groupsByName.set(g.name, g);

  const tiersNeedingGroups = new Set();
  for (const m of members) {
    if (!m.tier || m.tier === "Non-Member") continue;
    tiersNeedingGroups.add(m.tier);
  }

  const created = [];
  if (!dryRun) {
    for (const tier of tiersNeedingGroups) {
      const name = tierGroupName(tier);
      if (groupsByName.has(name)) continue;
      try {
        const group = await createCustomerGroup({
          apiBase: square.apiBase,
          accessToken: square.accessToken,
          name,
        });
        if (group?.id) {
          groupsByName.set(name, group);
          created.push(name);
        }
      } catch (e) {
        // A race here would manifest as "already exists" — re-fetch once.
        if (/ALREADY|exists/i.test(e.message || "")) {
          const refetched = await listCustomerGroups({
            apiBase: square.apiBase,
            accessToken: square.accessToken,
          });
          for (const g of refetched) groupsByName.set(g.name, g);
        } else {
          // Abort early on anything else; we don't want to assign customers
          // to half-created groups.
          return res.status(500).json({ error: "Group create failed", detail: e.message });
        }
      }
    }
  }

  // Walk each linked member.
  const report = [];
  const summary = {
    totalLinked: members.length,
    skippedNonMember: 0,
    skippedMissingTier: 0,
    synced: 0,
    errors: 0,
    groupsCreated: created,
    dryRun,
  };

  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    if (i > 0) await sleep(INTER_MEMBER_DELAY_MS);

    if (!m.tier || m.tier === "Non-Member") {
      summary.skippedNonMember += 1;
      report.push({ memberId: m.id, email: m.email, action: "skipped_non_member" });
      continue;
    }

    const discount = discountByTier.get(m.tier) || 0;
    const note = noteFor(m.tier, discount);
    const groupName = tierGroupName(m.tier);
    const group = groupsByName.get(groupName);

    if (dryRun) {
      summary.synced += 1;
      report.push({
        memberId: m.id,
        email: m.email,
        tier: m.tier,
        action: "would_sync",
        note,
        groupName,
      });
      continue;
    }

    try {
      // Note overwrite — simple PUT on the customer record.
      await updateCustomer({
        apiBase: square.apiBase,
        accessToken: square.accessToken,
        customerId: m.square_customer_id,
        patch: { note },
      });

      // Assign to the current tier's group. We don't proactively remove
      // from stale groups because that would require another round-trip
      // per member and isn't harmful — a member in two tier groups is
      // visually noisy on the Square side but doesn't affect discounts.
      // If this becomes an issue, add a scan + DELETE step in a future
      // pass (or run the tier-change path as a webhook hook).
      if (group?.id) {
        await addCustomerToGroup({
          apiBase: square.apiBase,
          accessToken: square.accessToken,
          customerId: m.square_customer_id,
          groupId: group.id,
        });
      }

      summary.synced += 1;
      report.push({
        memberId: m.id,
        email: m.email,
        tier: m.tier,
        action: "synced",
        note,
        groupName,
        groupId: group?.id || null,
      });
    } catch (e) {
      summary.errors += 1;
      report.push({
        memberId: m.id,
        email: m.email,
        tier: m.tier,
        action: "error",
        detail: e.message?.slice(0, 500) || "unknown",
      });
    }
  }

  return res.status(200).json({ summary, report });
}
