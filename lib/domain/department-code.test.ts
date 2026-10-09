import { describe, expect, it } from "vitest";

import { departmentCodeFromName, firstFreeCode } from "./department-code";

describe("departmentCodeFromName (D51)", () => {
  it("uses the initials of a multi-word name", () => {
    expect(departmentCodeFromName("Delivery Org / Administration")).toBe("DOA");
    expect(departmentCodeFromName("Human Resources")).toBe("HR");
    expect(departmentCodeFromName("Client Delivery Services")).toBe("CDS");
  });

  it("uses the first three letters of a one-word name", () => {
    expect(departmentCodeFromName("Engineering")).toBe("ENG");
    expect(departmentCodeFromName("  finance ")).toBe("FIN");
  });

  it("never returns fewer than two characters, nor more than six initials", () => {
    expect(departmentCodeFromName("X")).toBe("XX");
    expect(departmentCodeFromName("A b")).toBe("AB");
    expect(departmentCodeFromName("One Two Three Four Five Six Seven Eight")).toBe("OTTFFS");
    expect(departmentCodeFromName("—")).toBe("DEPT");
    expect(departmentCodeFromName("Café Ops")).toBe("CO");
  });
});

describe("firstFreeCode", () => {
  it("keeps the base when free, otherwise adds the first free number", () => {
    expect(firstFreeCode("HR", new Set())).toBe("HR");
    expect(firstFreeCode("HR", new Set(["HR"]))).toBe("HR2");
    expect(firstFreeCode("HR", new Set(["HR", "HR2", "HR3"]))).toBe("HR4");
  });

  it("stays within 30 characters", () => {
    const base = "A".repeat(30);
    expect(firstFreeCode(base, new Set([base]))).toHaveLength(30);
  });
});
