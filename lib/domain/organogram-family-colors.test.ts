import { describe, expect, it } from "vitest";

import {
  FAMILY_COLOR_PALETTE,
  buildFamilyColorMap,
  departmentColorFromHex,
  VISILY_DEPARTMENT_SWATCHES,
  lightTint,
} from "./organogram-family-colors";

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

describe("departmentColorFromHex", () => {
  it("uses a non-reference hex as the accent and a pastel of it as the fill", () => {
    // #16a34a is not a Visily reference colour, so the generic rule applies.
    const c = departmentColorFromHex("#16a34a");
    expect(c.accent).toBe("#16a34a");
    expect(c.fill).toMatch(/^#[0-9a-f]{6}$/i);
    expect(c.fill).not.toBe(c.accent);
    // The fill is lighter than the accent (blended toward white).
    expect(c.fill).toBe(lightTint("#16a34a", 0.34));
  });

  it("renders a Visily reference colour with the reference's exact fill and border", () => {
    expect(departmentColorFromHex("#4fae2f")).toEqual({ fill: "#d3f1b7", accent: "#95d25f" });
    expect(departmentColorFromHex("#E8811A")).toEqual({ fill: "#f2a84b", accent: "#bc7529" });
    expect(departmentColorFromHex(" #d9a400 ")).toEqual({ fill: "#f8d850", accent: "#d1b544" });
  });

  it("falls back to a neutral grey when the colour is null or invalid", () => {
    const nullish = departmentColorFromHex(null);
    const invalid = departmentColorFromHex("not-a-hex");
    expect(nullish.accent).toBe("#94a3b8");
    expect(invalid.accent).toBe("#94a3b8");
    expect(nullish).toEqual(invalid);
  });
});

describe("VISILY_DEPARTMENT_SWATCHES — readability (WCAG AA)", () => {
  // Relative luminance / contrast ratio per WCAG 2.x.
  function luminance(hex: string): number {
    const int = parseInt(hex.slice(1), 16);
    const channel = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return (
      0.2126 * channel((int >> 16) & 0xff) +
      0.7152 * channel((int >> 8) & 0xff) +
      0.0722 * channel(int & 0xff)
    );
  }
  function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  }
  // The card's text colour (app/globals.css --color-foreground). Filled cards
  // render ALL their text in it (no muted grey), so this is the pair to check.
  const CARD_TEXT = "#2d2d2d";

  it.each([...VISILY_DEPARTMENT_SWATCHES])(
    "%s fill keeps card text at >= 4.5:1",
    (_hex, swatch) => {
      expect(contrast(swatch.fill, CARD_TEXT)).toBeGreaterThanOrEqual(4.5);
    }
  );
});
