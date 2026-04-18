// POST /api/admin-square-backfill
// Tenant-admin triggered. Walks every member (within the caller's tenant)
// and links them to a Square customer record so their in-app QR (which
// encodes member.id) round-trips when Square Register scans it.
//
// Strategy per member:
//   1. Already has square_customer_id → skip (report as 'alreadyLinked').
//   2. Search Square by email.
//      - 1 match with reference_id == member.id → just write square_customer_id back.
//      - 1 match with different reference_id      → flag 'conflict' for manual review.
//      - 1 match with empty reference_id          → PUT reference_id + write square_customer_id.
//      - 0 matches → POST new Square customer with reference_id, write square_customer_id.
//      - >1 matches → flag 'duplicate' for manual review.
//
// Supports dryRun=true for safe previewing. Returns a per-member report.
//
// Constraints / footguns:
//   - Square returns up to 100 customers per SearchCustomers call; with
//     <1000 members per tenant we stay well inside that.
//   - We await every Square call (no fire-and-forget) because Vercel
//     serverless freezes on response return — see gotcha #1 in the
//     session handoff.

import { verifyAdmin, SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";
import { verifyPlatformAdmin } from "../../lib/platform-auth";
import { getSquareCredentials } from "../../lib/square-config";
import {
  searchCustomerByEmail,
  createCustomer,
  updateCustomerReferenceId,
  splitName,
  sleep,
} from "../../lib/square-api";

// Pace inter-member API calls so we stay under Square's SearchCustomers
// rate limit. Roughly 3 req/sec keeps a 66-member backfill well below
// Square's observed burst ceiling while still finishing inside Vercel's
// serverless timeout window (~300ms x 66 = 20s + API latency).
const INTER_MEMBER_DELAY_MS = 300;

// 60s matches Vercel Pro's default ceiling. Pacing is 300ms between
// members plus ~300ms per API call; worst case ~40s for HG's ~66
// paying members. Set explicitly so a plan-tier change or a future
// larger tenant doesn't silently truncate the run.
export const config = { maxDuration: 60 };

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // Dual auth: tenant admins trigger for their own tenant (tenant_id from
  // x-tenant-id header), platform admins trigger for any tenant (tenant_id
  // from body). Platform path is what powers the Run-backfill button in
  // /platform/tenants/<slug> → Square.
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

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const body = req.body || {};
  const dryRun = !!body.dryRun;

  let square;
  try {
    square = await getSquareCredentials(tenantId);
  } catch (e) {
    return res.status(400).json({ error: "Square not configured", detail: e.message });
  }

  // Pull every member in the tenant. We only backfill real members
  // (skip Non-Member ghost rows used for guests/drop-ins).
  const memResp = await fetch(
    `${SUPABASE_URL}/rest/v1/members?tenant_id=eq.${tenantId}&select=id,email,name,tier,square_customer_id&tier=neq.Non-Member`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  if (!memResp.ok) return res.status(500).json({ error: "Member lookup failed" });
  const members = await memResp.json();

  const report = [];
  const summary = {
    totalMembers: members.length,
    alreadyLinked: 0,
    matchedExactReference: 0,
    matchedBackfilledReference: 0,
    createdInSquare: 0,
    conflicts: 0,
    duplicates: 0,
    errors: 0,
    dryRun,
  };

  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    if (i > 0) await sleep(INTER_MEMBER_DELAY_MS);

    if (m.square_customer_id) {
      summary.alreadyLinked += 1;
      report.push({ memberId: m.id, email: m.email, action: "already_linked", squareCustomerId: m.square_customer_id });
      continue;
    }

    const email = (m.email || "").trim().toLowerCase();
    if (!email) {
      summary.errors += 1;
      report.push({ memberId: m.id, email: null, action: "error", detail: "member has no email" });
      continue;
    }

    try {
      const matches = await searchCustomerByEmail({
        apiBase: square.apiBase,
        accessToken: square.accessToken,
        email,
      });

      if (matches.length > 1) {
        summary.duplicates += 1;
        report.push({
          memberId: m.id,
          email,
          action: "duplicate_flagged",
          detail: `${matches.length} Square customers found with this email`,
          squareIds: matches.map((c) => c.id),
        });
        continue;
      }

      if (matches.length === 1) {
        const sq = matches[0];
        if (sq.reference_id === m.id) {
          // Perfect alignment already — just write our side.
          if (!dryRun) await linkMember(key, m.id, sq.id);
          summary.matchedExactReference += 1;
          report.push({ memberId: m.id, email, action: "linked", squareCustomerId: sq.id });
          continue;
        }
        if (sq.reference_id && sq.reference_id !== m.id) {
          summary.conflicts += 1;
          report.push({
            memberId: m.id,
            email,
            action: "conflict_flagged",
            detail: `Square customer has reference_id=${sq.reference_id}, differs from member.id. Manual review required.`,
            squareCustomerId: sq.id,
          });
          continue;
        }
        // Empty reference_id → claim it.
        if (!dryRun) {
          await updateCustomerReferenceId({
            apiBase: square.apiBase,
            accessToken: square.accessToken,
            customerId: sq.id,
            referenceId: m.id,
          });
          await linkMember(key, m.id, sq.id);
        }
        summary.matchedBackfilledReference += 1;
        report.push({ memberId: m.id, email, action: "backfilled_reference", squareCustomerId: sq.id });
        continue;
      }

      // No match → create.
      if (!dryRun) {
        const { givenName, familyName } = splitName(m.name);
        const created = await createCustomer({
          apiBase: square.apiBase,
          accessToken: square.accessToken,
          email,
          givenName,
          familyName,
          referenceId: m.id,
          idempotencyKey: `backfill-${m.id}`,
        });
        if (!created?.id) throw new Error("Square create returned no id");
        await linkMember(key, m.id, created.id);
        summary.createdInSquare += 1;
        report.push({ memberId: m.id, email, action: "created", squareCustomerId: created.id });
      } else {
        summary.createdInSquare += 1;
        report.push({ memberId: m.id, email, action: "would_create" });
      }
    } catch (e) {
      summary.errors += 1;
      report.push({
        memberId: m.id,
        email,
        action: "error",
        detail: e.message?.slice(0, 500) || "unknown",
      });
    }
  }

  return res.status(200).json({ summary, report });
}

async function linkMember(serviceKey, memberId, squareCustomerId) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/members?id=eq.${encodeURIComponent(memberId)}`,
    {
      method: "PATCH",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ square_customer_id: squareCustomerId }),
    }
  );
  if (!r.ok) throw new Error(`member PATCH ${r.status} ${await r.text()}`);
}
