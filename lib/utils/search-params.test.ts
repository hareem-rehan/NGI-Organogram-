import { describe, expect, it } from "vitest";

import {
  parseBooleanParam,
  parseEnumParam,
  parseIntListParam,
  parseUuidListParam,
  parseUuidParam,
} from "./search-params";

describe("parseEnumParam", () => {
  const ALLOWED = ["ALL", "ACTIVE", "INACTIVE"] as const;

  it("returns the value when it is in the allowed set", () => {
    expect(parseEnumParam("ACTIVE", ALLOWED, "ALL")).toBe("ACTIVE");
  });

  it("returns the fallback for null (param absent)", () => {
    expect(parseEnumParam(null, ALLOWED, "ALL")).toBe("ALL");
  });

  it("returns the fallback for a value outside the allowed set (rejects, never passes through unvalidated)", () => {
    expect(parseEnumParam("DELETED", ALLOWED, "ALL")).toBe("ALL");
  });

  it("returns the fallback for an empty string", () => {
    expect(parseEnumParam("", ALLOWED, "ALL")).toBe("ALL");
  });
});

describe("parseUuidParam", () => {
  const VALID_UUID = "11111111-1111-4111-8111-111111111111";

  it("returns a well-formed UUID unchanged", () => {
    expect(parseUuidParam(VALID_UUID)).toBe(VALID_UUID);
  });

  it("returns empty string for null", () => {
    expect(parseUuidParam(null)).toBe("");
  });

  it("returns empty string for a malformed value rather than passing it through", () => {
    expect(parseUuidParam("not-a-uuid")).toBe("");
  });

  it("returns empty string for an excessively long or script-like value", () => {
    expect(parseUuidParam("<script>alert(1)</script>")).toBe("");
  });
});

describe("parseUuidListParam", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";

  it("parses a comma-separated list of valid UUIDs", () => {
    expect(parseUuidListParam(`${A},${B}`)).toEqual([A, B]);
  });

  it("returns [] for null or empty", () => {
    expect(parseUuidListParam(null)).toEqual([]);
    expect(parseUuidListParam("")).toEqual([]);
  });

  it("drops a malformed entry without discarding the whole list", () => {
    expect(parseUuidListParam(`${A},not-a-uuid,${B}`)).toEqual([A, B]);
  });

  it("deduplicates repeated ids", () => {
    expect(parseUuidListParam(`${A},${A}`)).toEqual([A]);
  });

  it("returns [] for an excessively long raw value", () => {
    expect(parseUuidListParam("a".repeat(3000))).toEqual([]);
  });

  it("returns [] when the entry count is excessive", () => {
    const many = Array.from({ length: 60 }, () => A).join(",");
    expect(parseUuidListParam(many)).toEqual([]);
  });
});

describe("parseIntListParam", () => {
  it("parses a comma-separated list of integers within range", () => {
    expect(parseIntListParam("1,2,3", 1, 20)).toEqual([1, 2, 3]);
  });

  it("returns [] for null or empty", () => {
    expect(parseIntListParam(null, 1, 20)).toEqual([]);
    expect(parseIntListParam("", 1, 20)).toEqual([]);
  });

  it("drops out-of-range and non-numeric entries without discarding the whole list", () => {
    expect(parseIntListParam("1,999,abc,3", 1, 20)).toEqual([1, 3]);
  });

  it("deduplicates and sorts", () => {
    expect(parseIntListParam("3,1,3,2", 1, 20)).toEqual([1, 2, 3]);
  });

  it("returns [] for an excessive entry count", () => {
    const many = Array.from({ length: 60 }, (_, i) => i + 1).join(",");
    expect(parseIntListParam(many, 1, 200)).toEqual([]);
  });
});

describe("parseBooleanParam", () => {
  it('parses "true" and "false" literally', () => {
    expect(parseBooleanParam("true", false)).toBe(true);
    expect(parseBooleanParam("false", true)).toBe(false);
  });

  it("falls back for null, absent, or any other value — never a truthy-string coercion", () => {
    expect(parseBooleanParam(null, true)).toBe(true);
    expect(parseBooleanParam("1", true)).toBe(true);
    expect(parseBooleanParam("yes", false)).toBe(false);
  });
});
