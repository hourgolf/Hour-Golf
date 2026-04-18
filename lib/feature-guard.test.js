// Tests for lib/feature-guard.js — the API-route feature flag gate.
//
// assertFeature talks to loadFeatures + isFeatureEnabled from
// lib/tenant-features.js. We mock that dependency so we're actually
// testing the guard's behavior (response shape, status code, return
// value, fail-open semantics) rather than the underlying fetch layer.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mock: must be set up before any import of feature-guard.
vi.mock("./tenant-features.js", () => ({
  loadFeatures: vi.fn(),
  isFeatureEnabled: vi.fn(),
}));

// Import AFTER the mock is registered.
const { assertFeature } = await import("./feature-guard.js");
const { loadFeatures, isFeatureEnabled } = await import("./tenant-features.js");

function makeRes() {
  const res = {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };
  return res;
}

describe("assertFeature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when the feature is enabled, does NOT touch res", async () => {
    loadFeatures.mockResolvedValue({ pro_shop: true });
    isFeatureEnabled.mockReturnValue(true);

    const res = makeRes();
    const result = await assertFeature(res, "tenant-uuid", "pro_shop");

    expect(result).toBe(true);
    expect(res.statusCode).toBeNull();
    expect(res.payload).toBeNull();
  });

  it("returns false and sends 404 when the feature is disabled", async () => {
    loadFeatures.mockResolvedValue({ pro_shop: false });
    isFeatureEnabled.mockReturnValue(false);

    const res = makeRes();
    const result = await assertFeature(res, "tenant-uuid", "pro_shop");

    expect(result).toBe(false);
    expect(res.statusCode).toBe(404);
    expect(res.payload).toEqual({
      error: "feature_disabled",
      detail: "Feature `pro_shop` is not enabled for this tenant.",
    });
  });

  it("fails open: returns true when loadFeatures throws", async () => {
    // Silence the console.error the guard emits on failure — we don't
    // need that noise in the test runner. Restore afterwards.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    loadFeatures.mockRejectedValue(new Error("network down"));

    const res = makeRes();
    const result = await assertFeature(res, "tenant-uuid", "pro_shop");

    expect(result).toBe(true);
    expect(res.statusCode).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("handles a null res gracefully (still returns false on disabled)", async () => {
    // Some call sites pass null; guard must not crash. It can't send a
    // 404 without a res, so we just verify the return value.
    loadFeatures.mockResolvedValue({ events: false });
    isFeatureEnabled.mockReturnValue(false);

    const result = await assertFeature(null, "tenant-uuid", "events");
    expect(result).toBe(false);
  });
});
