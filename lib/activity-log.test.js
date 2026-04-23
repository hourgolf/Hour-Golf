// Pure-function tests for the activity-log payload builder. No network
// or DB — logActivity itself is fire-and-forget and its failure modes
// are exercised in integration via console.error, not here.

import { describe, it, expect } from "vitest";
import { buildActivityPayload } from "./activity-log.js";

describe("buildActivityPayload", () => {
  it("returns null when tenantId is missing or non-string", () => {
    expect(buildActivityPayload({ action: "x" })).toBe(null);
    expect(buildActivityPayload({ tenantId: 42, action: "x" })).toBe(null);
    expect(buildActivityPayload({ tenantId: "", action: "x" })).toBe(null);
  });

  it("returns null when action is missing or non-string", () => {
    expect(buildActivityPayload({ tenantId: "t" })).toBe(null);
    expect(buildActivityPayload({ tenantId: "t", action: 0 })).toBe(null);
    expect(buildActivityPayload({ tenantId: "t", action: "" })).toBe(null);
  });

  it("builds a full payload from valid input", () => {
    const p = buildActivityPayload({
      tenantId: "t1",
      actor: { id: "u1", email: "admin@example.com" },
      action: "member.tier_changed",
      targetType: "member",
      targetId: "alice@example.com",
      metadata: { from: "Patron", to: "Unlimited" },
    });
    expect(p).toEqual({
      tenant_id: "t1",
      actor_user_id: "u1",
      actor_email: "admin@example.com",
      action: "member.tier_changed",
      target_type: "member",
      target_id: "alice@example.com",
      metadata: { from: "Patron", to: "Unlimited" },
    });
  });

  it("tolerates missing actor, targetType, targetId, metadata", () => {
    const p = buildActivityPayload({ tenantId: "t1", action: "a" });
    expect(p.actor_user_id).toBeNull();
    expect(p.actor_email).toBeNull();
    expect(p.target_type).toBeNull();
    expect(p.target_id).toBeNull();
    expect(p.metadata).toBeNull();
  });

  it("coerces numeric target_id to string", () => {
    const p = buildActivityPayload({ tenantId: "t", action: "a", targetId: 42 });
    expect(p.target_id).toBe("42");
  });

  it("truncates overlong action and target_id strings", () => {
    const long = "a".repeat(1000);
    const p = buildActivityPayload({
      tenantId: "t",
      action: long,
      targetId: long,
    });
    expect(p.action.length).toBe(100);
    expect(p.target_id.length).toBe(500);
  });

  it("caps metadata to MAX_METADATA_KEYS entries", () => {
    const metadata = {};
    for (let i = 0; i < 50; i++) metadata[`k${i}`] = i;
    const p = buildActivityPayload({ tenantId: "t", action: "a", metadata });
    expect(Object.keys(p.metadata).length).toBe(20);
  });

  it("truncates long string values in metadata", () => {
    const p = buildActivityPayload({
      tenantId: "t",
      action: "a",
      metadata: { note: "x".repeat(1000) },
    });
    expect(p.metadata.note.length).toBe(500);
  });

  it("preserves numbers, booleans, and null in metadata", () => {
    const p = buildActivityPayload({
      tenantId: "t",
      action: "a",
      metadata: { delta: 5, paid: true, reason: null },
    });
    expect(p.metadata).toEqual({ delta: 5, paid: true, reason: null });
  });

  it("serializes nested objects in metadata via JSON round-trip", () => {
    const p = buildActivityPayload({
      tenantId: "t",
      action: "a",
      metadata: { before: { tier: "Patron" }, after: { tier: "Starter" } },
    });
    expect(p.metadata.before).toEqual({ tier: "Patron" });
    expect(p.metadata.after).toEqual({ tier: "Starter" });
  });
});
