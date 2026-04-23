import { verifyAdmin } from "../../lib/api-helpers";
import { logActivity } from "../../lib/activity-log";

// Thin endpoint so admin UI code that mutates via direct PostgREST
// (cancel/delete/restore booking, inline tier/profile edits, etc.)
// can still leave an audit trail. Server-side mutation routes log
// directly — they should NOT call this.
//
// Body: { action, targetType?, targetId?, metadata? }
// Never fails the caller: even if the insert fails internally,
// logActivity swallows it. The 200 just confirms "we tried."

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { user, tenantId, reason } = await verifyAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", reason });

  const { action, targetType, targetId, metadata } = req.body || {};
  if (!action || typeof action !== "string") {
    return res.status(400).json({ error: "action required" });
  }

  await logActivity({
    tenantId,
    actor: { id: user.id, email: user.email },
    action,
    targetType: targetType || null,
    targetId: targetId == null ? null : targetId,
    metadata: metadata && typeof metadata === "object" ? metadata : null,
  });

  return res.status(200).json({ ok: true });
}
