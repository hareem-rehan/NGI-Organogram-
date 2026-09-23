import { describe, expect, it } from "vitest";

import { FAMILY_COLOR_PALETTE, buildFamilyColorMap, lightTint } from "./organogram-family-colors";

describe("lightTint", () => {
  it("blends a colour toward white into a readable pastel", () => {
    // 22% of #16a34a mixed with 78% white.
    expect(lightTint("#16a34a")).toBe("#ccebd7");
  });

  it("accepts a bare (no-hash) 6-digit hex", () => {
    expect(lightTint("16a34a")).toBe("#ccebd7");
  });

  it("returns an unparseable colour unchanged (e.g. a CSS var)", () => {
    expect(lightTint("var(--color-border)")).toBe("var(--color-border)");
  });

  it("keeps more of the base colour at a higher weight", () => {
    // Fully weighted is the original colour; unweighted is white.
    expect(lightTint("#16a34a", 1)).toBe("#16a34a");
    expect(lightTint("#16a34a", 0)).toBe("#ffffff");
  });
});

describe("buildFamilyColorMap", () => {
  it("assigns palette colours to families in the given order", () => {
    const map = buildFamilyColorMap(["fam-a", "fam-b", "fam-c"]);
    expect(map.get("fam-a")).toEqual(FAMILY_COLOR_PALETTE[0]);
    expect(map.get("fam-b")).toEqual(FAMILY_COLOR_PALETTE[1]);
    expect(map.get("fam-c")).toEqual(FAMILY_COLOR_PALETTE[2]);
  });

  it("is deterministic — the same order yields the same mapping", () => {
    const ids = ["x", "y", "z"];
    expect(buildFamilyColorMap(ids)).toEqual(buildFamilyColorMap(ids));
  });

  it("cycles the palette when there are more families than colours", () => {
    const ids = Array.from({ length: FAMILY_COLOR_PALETTE.length + 2 }, (_, i) => `f${i}`);
    const map = buildFamilyColorMap(ids);
    expect(map.get("f0")).toEqual(FAMILY_COLOR_PALETTE[0]);
    // Wraps back to the start of the palette.
    expect(map.get(`f${FAMILY_COLOR_PALETTE.length}`)).toEqual(FAMILY_COLOR_PALETTE[0]);
    expect(map.get(`f${FAMILY_COLOR_PALETTE.length + 1}`)).toEqual(FAMILY_COLOR_PALETTE[1]);
  });

  it("every palette entry is a light fill with a stronger accent", () => {
    // Both are 6-digit hex; sanity-guards the reference palette shape.
    for (const c of FAMILY_COLOR_PALETTE) {
      expect(c.fill).toMatch(/^#[0-9a-f]{6}$/i);
      expect(c.accent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(c.fill).not.toEqual(c.accent);
    }
  });
});
