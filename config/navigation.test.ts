import { describe, expect, it } from "vitest";

import { NAV_ITEMS } from "./navigation";

describe("NAV_ITEMS", () => {
  it("has at least the eight Phase 1 modules", () => {
    expect(NAV_ITEMS.length).toBeGreaterThanOrEqual(8);
  });

  it("every item has a unique, absolute href", () => {
    const hrefs = NAV_ITEMS.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of hrefs) {
      expect(href.startsWith("/")).toBe(true);
    }
  });

  it("every item has a non-empty label and description", () => {
    for (const item of NAV_ITEMS) {
      expect(item.label.trim().length).toBeGreaterThan(0);
      expect(item.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("every item names a positive, integer planned phase", () => {
    for (const item of NAV_ITEMS) {
      expect(Number.isInteger(item.plannedPhase)).toBe(true);
      expect(item.plannedPhase).toBeGreaterThan(0);
    }
  });
});
