import { describe, expect, it } from "vitest";

import { formatEmployeeDisplayName, normalizeCode, normalizeWorkEmail } from "./normalize";

describe("normalizeCode", () => {
  it("trims and uppercases", () => {
    expect(normalizeCode("  eng-platform  ")).toBe("ENG-PLATFORM");
  });

  it("is idempotent", () => {
    expect(normalizeCode(normalizeCode("Eng"))).toBe(normalizeCode("Eng"));
  });
});

describe("normalizeWorkEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeWorkEmail("  Jane.Doe@Example.TEST  ")).toBe("jane.doe@example.test");
  });

  it("returns null for null/undefined/empty/whitespace-only input", () => {
    expect(normalizeWorkEmail(null)).toBeNull();
    expect(normalizeWorkEmail(undefined)).toBeNull();
    expect(normalizeWorkEmail("")).toBeNull();
    expect(normalizeWorkEmail("   ")).toBeNull();
  });
});

describe("formatEmployeeDisplayName", () => {
  it("uses preferredName when set", () => {
    expect(
      formatEmployeeDisplayName({ firstName: "Jane", lastName: "Doe", preferredName: "JD" })
    ).toBe("JD");
  });

  it('falls back to "First Last" when preferredName is null', () => {
    expect(
      formatEmployeeDisplayName({ firstName: "Jane", lastName: "Doe", preferredName: null })
    ).toBe("Jane Doe");
  });

  it('falls back to "First Last" when preferredName is whitespace-only', () => {
    expect(
      formatEmployeeDisplayName({ firstName: "Jane", lastName: "Doe", preferredName: "   " })
    ).toBe("Jane Doe");
  });
});
