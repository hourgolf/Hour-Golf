// Tests for lib/platform-auth.js — the super-admin auth guard.
//
// Covers the failure codes the guard returns from each branch, plus
// the happy path. We stub global.fetch so the test doesn't need real
// Supabase access. env vars are set in beforeEach so getAnonKey /
// getServiceKey resolve inside the guard.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { verifyPlatformAdmin } = await import("./platform-auth.js");

function req({ authHeader } = {}) {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
  };
}

// Build a mock fetch that hands back a queue of responses in order.
// Each response is { ok, status, json } — we only call the fields the
// guard actually reads.
function mockFetchSequence(responses) {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[i++];
    if (!r) throw new Error("mock fetch ran out of responses");
    return {
      ok: r.ok,
      status: r.status || (r.ok ? 200 : 400),
      json: async () => r.body,
    };
  });
}

const ORIGINAL_FETCH = global.fetch;

describe("verifyPlatformAdmin", () => {
  beforeEach(() => {
    process.env.SUPABASE_ANON_KEY = "test-anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("returns missing_bearer_token when no Authorization header", async () => {
    const r = await verifyPlatformAdmin(req());
    expect(r.user).toBeNull();
    expect(r.reason).toBe("missing_bearer_token");
  });

  it("returns missing_bearer_token when Authorization is malformed", async () => {
    const r = await verifyPlatformAdmin(req({ authHeader: "NotBearer token" }));
    expect(r.user).toBeNull();
    expect(r.reason).toBe("missing_bearer_token");
  });

  it("returns auth_user_<status> when Supabase Auth rejects the JWT", async () => {
    global.fetch = mockFetchSequence([{ ok: false, status: 401, body: {} }]);
    const r = await verifyPlatformAdmin(req({ authHeader: "Bearer bad-jwt" }));
    expect(r.user).toBeNull();
    expect(r.reason).toBe("auth_user_401");
  });

  it("returns no_user_id when Supabase Auth returns a shape without id", async () => {
    global.fetch = mockFetchSequence([
      { ok: true, body: { email: "x@y.com" } }, // no `id`
    ]);
    const r = await verifyPlatformAdmin(req({ authHeader: "Bearer weird-jwt" }));
    expect(r.user).toBeNull();
    expect(r.reason).toBe("no_user_id");
  });

  it("returns not_in_platform_admins when the user is not in the allowlist", async () => {
    global.fetch = mockFetchSequence([
      { ok: true, body: { id: "user-uuid", email: "reg@example.com" } },
      { ok: true, body: [] }, // empty platform_admins lookup
    ]);
    const r = await verifyPlatformAdmin(
      req({ authHeader: "Bearer regular-admin-jwt" })
    );
    expect(r.user).toBeNull();
    expect(r.reason).toBe("not_in_platform_admins");
  });

  it("returns platform_admins_query_<status> on DB error", async () => {
    global.fetch = mockFetchSequence([
      { ok: true, body: { id: "user-uuid", email: "x@y.com" } },
      { ok: false, status: 500, body: {} },
    ]);
    const r = await verifyPlatformAdmin(req({ authHeader: "Bearer jwt" }));
    expect(r.user).toBeNull();
    expect(r.reason).toBe("platform_admins_query_500");
  });

  it("returns the user + platformAdmin row on the happy path", async () => {
    const user = { id: "user-uuid", email: "matt@multifresh.com" };
    const adminRow = {
      user_id: "user-uuid",
      email: "matt@multifresh.com",
      display_name: "Matt",
    };
    global.fetch = mockFetchSequence([
      { ok: true, body: user },
      { ok: true, body: [adminRow] },
    ]);
    const r = await verifyPlatformAdmin(req({ authHeader: "Bearer good-jwt" }));
    expect(r.user).toEqual(user);
    expect(r.platformAdmin).toEqual(adminRow);
    expect(r.reason).toBeNull();
  });
});
