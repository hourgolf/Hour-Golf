// /pages/api/booking-webhook.js
//
// DEPRECATED — scheduled for removal (1–3 month horizon as of 2026-04-16).
// This endpoint exists to receive Zapier-relayed bookings from Skedda.
// Both Skedda and Zapier are being removed; the native customer-book.js
// flow (which is already tenant-scoped) will be the sole booking path.
//
// DO NOT add multi-tenant features to this file. It was intentionally
// skipped in Phase 2B-3 of the multi-tenant migration (see
// ~/.claude/plans/lovely-watching-bunny.md). When Skedda/Zapier are
// decommissioned, delete this file and the WEBHOOK_SECRET env var.
//
// Until removed, this endpoint inserts bookings that automatically pick
// up Hour Golf's tenant_id via the column DEFAULT seeded in migration
// 20260417000000_multitenant_foundation. That default remains in place
// through Phase 2C specifically so legacy paths like this keep working.
//
// Original behavior: handles the insert; Supabase triggers do duration calc.

import { sendBookingConfirmation, sendBookingConflictAlert } from "../../lib/email";
import { getRequestOrigin } from "../../lib/api-helpers";
import { safePush } from "../../lib/admin-push";

const HOURGOLF_TENANT_ID = "11111111-1111-4111-8111-111111111111";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // Auth: accept either a shared secret or the Supabase anon key
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");
  const webhookSecret = process.env.WEBHOOK_SECRET || process.env.SUPABASE_ANON_KEY;
  if (token !== webhookSecret && req.headers["x-webhook-secret"] !== webhookSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://uxpkqbioxoezjmcoylkw.supabase.co";
  // Use the service role key so writes succeed even after RLS is enabled.
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  try {
    // Accept single booking or array
    const bookings = Array.isArray(req.body) ? req.body : [req.body];
    const results = [];

    for (const b of bookings) {
      const record = {
        booking_id: String(b.booking_id || ""),
        customer_email: (b.customer_email || "").toLowerCase().trim(),
        customer_name: b.customer_name || "",
        booking_start: b.booking_start,
        booking_end: b.booking_end,
        // Send whatever duration — the Supabase trigger will override with correct calc
        duration_hours: parseFloat(b.duration_hours) || 0,
        bay: b.bay || b.space_name || "",
        booking_status: b.booking_status || "Confirmed",
      };

      if (!record.booking_id || !record.customer_email || !record.booking_start) {
        results.push({ booking_id: record.booking_id, status: "skipped", reason: "missing required fields" });
        continue;
      }

      // Upsert: insert or update if booking_id already exists
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/bookings`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation,resolution=merge-duplicates",
        },
        body: JSON.stringify(record),
      });

      if (resp.ok) {
        const data = await resp.json();
        const booked = data[0];
        results.push({ booking_id: record.booking_id, status: "ok", duration_hours: booked?.duration_hours });

        // --- Conflict detection (Skedda → new-portal transition) ---
        //
        // Skedda has no visibility into new-portal bookings, so a
        // member can book the same slot there and it lands here as
        // an overlap. We can't reject the write (they already
        // committed on Skedda's side), so: flag BOTH rows with the
        // conflict columns, email the admin immediately, keep the
        // existing booking-confirmation email firing.
        //
        // Scope: same bay + overlapping time window + tenant 1 (HG —
        // this webhook is HG-only per the file header). Skip cancelled
        // rows on either side. Self-upserts (same booking_id coming
        // through again) don't count as conflicts.
        try {
          if (booked && record.booking_status === "Confirmed") {
            const overlapResp = await fetch(
              `${SUPABASE_URL}/rest/v1/bookings?tenant_id=eq.${HOURGOLF_TENANT_ID}` +
                `&bay=eq.${encodeURIComponent(booked.bay || "")}` +
                `&booking_status=eq.Confirmed` +
                `&booking_id=neq.${encodeURIComponent(booked.booking_id)}` +
                `&booking_start=lt.${encodeURIComponent(booked.booking_end)}` +
                `&booking_end=gt.${encodeURIComponent(booked.booking_start)}` +
                `&select=booking_id,customer_email,customer_name,booking_start,booking_end,bay,conflict_with`,
              { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
            );
            const overlaps = overlapResp.ok ? await overlapResp.json() : [];
            if (overlaps.length > 0) {
              const nowIso = new Date().toISOString();
              const otherIds = overlaps.map((r) => r.booking_id).filter(Boolean);

              // Stamp the incoming row with its conflict partners.
              await fetch(
                `${SUPABASE_URL}/rest/v1/bookings?booking_id=eq.${encodeURIComponent(booked.booking_id)}&tenant_id=eq.${HOURGOLF_TENANT_ID}`,
                {
                  method: "PATCH",
                  headers: {
                    apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
                    "Content-Type": "application/json", Prefer: "return=minimal",
                  },
                  body: JSON.stringify({
                    conflict_with: otherIds.join(","),
                    conflict_detected_at: nowIso,
                  }),
                }
              );

              // Stamp every existing partner with the incoming id
              // appended to its conflict_with list. PATCH per row
              // keeps the merge logic simple without a server-side
              // function.
              for (const other of overlaps) {
                const merged = [
                  ...String(other.conflict_with || "").split(",").filter(Boolean),
                  booked.booking_id,
                ].filter((v, i, a) => v && a.indexOf(v) === i);
                await fetch(
                  `${SUPABASE_URL}/rest/v1/bookings?booking_id=eq.${encodeURIComponent(other.booking_id)}&tenant_id=eq.${HOURGOLF_TENANT_ID}`,
                  {
                    method: "PATCH",
                    headers: {
                      apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
                      "Content-Type": "application/json", Prefer: "return=minimal",
                    },
                    body: JSON.stringify({
                      conflict_with: merged.join(","),
                      conflict_detected_at: other.conflict_detected_at || nowIso,
                    }),
                  }
                );
              }

              // Alert admin. Awaited (same reason as the confirmation
              // email below — Vercel freezes fire-and-forget on return).
              try {
                await sendBookingConflictAlert({
                  tenantId: HOURGOLF_TENANT_ID,
                  incoming: booked,
                  existing: overlaps[0], // email body focuses on the first overlap; UI surfaces all
                });
              } catch (e) {
                console.error("Booking conflict alert failed:", e);
              }

              // Push notify admin PWAs. safePush never throws.
              await safePush(HOURGOLF_TENANT_ID, {
                title: "⚠ Booking conflict",
                body: `${booked.customer_name || booked.customer_email} overlaps ${overlaps[0]?.customer_name || "another booking"} on ${booked.bay}`,
                url: "/admin?view=inbox",
                tag: `conflict-${booked.booking_id}`,
              });

              // Mark that we already notified admin of this booking
              // so the generic "new booking" push below doesn't
              // double-fire on top of the conflict alert.
              booked.__notifiedAsConflict = true;

              console.warn(
                `booking-webhook: DOUBLE BOOKING detected — ${booked.booking_id} overlaps ${otherIds.join(", ")} on ${booked.bay} ${booked.booking_start}`
              );
            }
          }
        } catch (e) {
          console.error("booking-webhook: conflict detection failed:", e);
        }

        // Send booking confirmation email (fire-and-forget)
        if (booked && record.booking_status === "Confirmed") {
          // This endpoint is deprecated (Skedda/Zapier removal pending),
          // and bookings here always fall back to Hour Golf's tenant_id
          // via the DB DEFAULT. Pin the email to Hour Golf branding
          // accordingly until the file is deleted. Awaited for the
          // same reason as customer-book.js — fire-and-forget on Vercel
          // drops the Resend call when the process freezes.
          try {
            await sendBookingConfirmation({
              tenantId: "11111111-1111-4111-8111-111111111111",
              to: booked.customer_email,
              customerName: booked.customer_name || booked.customer_email,
              bay: booked.bay,
              bookingStart: booked.booking_start,
              bookingEnd: booked.booking_end,
              portalUrl: getRequestOrigin(req),
            });
          } catch (e) {
            console.error("Booking confirmation email failed:", e);
          }

          // Push notify admin — but skip if we already sent a
          // conflict alert for this row (above). One notification
          // per booking event.
          if (!booked.__notifiedAsConflict) {
            const when = (() => {
              try {
                return new Date(booked.booking_start).toLocaleString("en-US", {
                  timeZone: "America/Los_Angeles",
                  weekday: "short", month: "short", day: "numeric",
                  hour: "numeric", minute: "2-digit",
                });
              } catch { return booked.booking_start; }
            })();
            await safePush(HOURGOLF_TENANT_ID, {
              title: "New booking",
              body: `${booked.customer_name || booked.customer_email} · ${when} · ${booked.bay}`,
              url: "/admin?view=today",
              tag: `booking-${booked.booking_id}`,
            });
          }
        }
      } else {
        const err = await resp.text();
        results.push({ booking_id: record.booking_id, status: "error", error: err });
      }
    }

    const ok = results.filter(r => r.status === "ok").length;
    const failed = results.filter(r => r.status === "error").length;

    return res.status(200).json({
      success: true,
      processed: results.length,
      ok,
      failed,
      results,
    });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).json({ error: "Webhook failed", detail: err.message });
  }
}
