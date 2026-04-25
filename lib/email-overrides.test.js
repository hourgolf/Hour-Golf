import { describe, it, expect } from "vitest";
import {
  applyTokens,
  applyOverride,
  getTemplateOverrides,
  validateTemplateOverrides,
  validateAllOverrides,
} from "./email-overrides.js";

describe("applyTokens", () => {
  it("substitutes simple tokens", () => {
    expect(applyTokens("Hey {name}, welcome to {venue}!", { "{name}": "Alex", "{venue}": "Hour Golf" }))
      .toBe("Hey Alex, welcome to Hour Golf!");
  });
  it("handles repeated tokens", () => {
    expect(applyTokens("{x}, {x}, {x}", { "{x}": "ok" })).toBe("ok, ok, ok");
  });
  it("leaves unknown tokens untouched", () => {
    expect(applyTokens("{name} and {age}", { "{name}": "Alex" })).toBe("Alex and {age}");
  });
  it("returns non-string input unchanged", () => {
    expect(applyTokens(null, {})).toBe(null);
    expect(applyTokens(42, {})).toBe(42);
  });
});

describe("getTemplateOverrides", () => {
  it("returns empty object when no overrides", () => {
    expect(getTemplateOverrides({}, "x")).toEqual({});
    expect(getTemplateOverrides({ email_overrides: null }, "x")).toEqual({});
    expect(getTemplateOverrides({ email_overrides: { y: { intro: "hi" } } }, "x")).toEqual({});
  });
  it("returns the slug's blob", () => {
    const branding = { email_overrides: { "booking-confirmation": { intro: "Hello {name}" } } };
    expect(getTemplateOverrides(branding, "booking-confirmation")).toEqual({ intro: "Hello {name}" });
  });
});

describe("applyOverride", () => {
  const tokens = { "{name}": "Alex" };
  it("returns the default with tokens substituted when no override", () => {
    expect(applyOverride("Hey {name}", {}, "booking-confirmation", "intro", tokens)).toBe("Hey Alex");
  });
  it("uses the override when present, with token substitution", () => {
    const branding = { email_overrides: { "booking-confirmation": { intro: "Yo {name}!" } } };
    expect(applyOverride("Hey {name}", branding, "booking-confirmation", "intro", tokens)).toBe("Yo Alex!");
  });
  it("falls back to default when override is empty string", () => {
    const branding = { email_overrides: { "booking-confirmation": { intro: "" } } };
    expect(applyOverride("Hey {name}", branding, "booking-confirmation", "intro", tokens)).toBe("Hey Alex");
  });
});

describe("validateTemplateOverrides", () => {
  it("rejects unknown templates", () => {
    expect(validateTemplateOverrides("nope", { intro: "x" })).toMatch(/Unknown template/);
  });
  it("rejects non-objects", () => {
    expect(validateTemplateOverrides("booking-confirmation", null)).toMatch(/object/);
    expect(validateTemplateOverrides("booking-confirmation", [])).toMatch(/object/);
  });
  it("rejects fields not in the editable list", () => {
    expect(validateTemplateOverrides("booking-confirmation", { hidden: "x" })).toMatch(/not editable/);
  });
  it("accepts valid blobs", () => {
    expect(validateTemplateOverrides("booking-confirmation", {
      subject: "Booked",
      intro: "Hello",
      cta_label: "Open",
    })).toBeNull();
  });
  it("rejects strings over the field's max", () => {
    const long = "x".repeat(300);
    expect(validateTemplateOverrides("booking-confirmation", { subject: long })).toMatch(/too long/);
  });
  it("accepts null/empty as a clear", () => {
    expect(validateTemplateOverrides("booking-confirmation", { intro: null })).toBeNull();
    expect(validateTemplateOverrides("booking-confirmation", { intro: "" })).toBeNull();
  });
});

describe("validateAllOverrides", () => {
  it("accepts null", () => {
    expect(validateAllOverrides(null)).toBeNull();
  });
  it("walks every slug and bubbles up first error", () => {
    expect(validateAllOverrides({
      "booking-confirmation": { intro: "ok" },
      "nope": { intro: "x" },
    })).toMatch(/Unknown template/);
  });
  it("accepts a healthy blob", () => {
    expect(validateAllOverrides({
      "booking-confirmation": { subject: "Hi", intro: "x", cta_label: "go" },
    })).toBeNull();
  });
});
