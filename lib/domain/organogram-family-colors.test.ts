import { describe, expect, it } from "vitest";

import {
  FAMILY_COLOR_PALETTE,
  buildFamilyColorMap,
  cardTextColor,
  departmentColorFromHex,
  contrastRatio,
  vividFill,
  CARD_TEXT_COLOR,
  lightTint,
  buildSubdivisionShadeMap,
  shadeOf,
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

describe("departmentColorFromHex (exact colour, 2026-10-02)", () => {
  it("fills the card with exactly the chosen colour", () => {
    expect(departmentColorFromHex("#111ED4")).toEqual({
      fill: "#111ed4",
      accent: "#111ed4",
      text: "#ffffff",
    });
    expect(departmentColorFromHex(" #f8d850 ")).toMatchObject({
      fill: "#f8d850",
      accent: "#f8d850",
    });
  });

  it.each(["#000000", "#111ed4", "#1e3a8a", "#7f1d1d", "#16a34a", "#e8811a", "#f8d850", "#ffffff"])(
    "picks the more readable text colour on %s (at least 4.5:1 where either can)",
    (hex) => {
      const c = departmentColorFromHex(hex);
      const best = Math.max(contrastRatio(hex, "#ffffff"), contrastRatio(hex, CARD_TEXT_COLOR));
      expect(contrastRatio(c.fill, c.text!)).toBe(best);
    }
  );

  it("uses white text on a dark colour and dark text on a light one", () => {
    expect(cardTextColor("#111ed4")).toBe("#ffffff");
    expect(cardTextColor("#f8d850")).toBe(CARD_TEXT_COLOR);
  });

  it("falls back to a neutral grey card when the colour is null or invalid", () => {
    const nullish = departmentColorFromHex(null);
    const invalid = departmentColorFromHex("not-a-hex");
    expect(nullish.accent).toBe("#94a3b8");
    expect(invalid.accent).toBe("#94a3b8");
    expect(nullish).toEqual(invalid);
  });
});

describe("vividFill / palette readability (WCAG AA)", () => {
  it("keeps card text readable on ANY department colour, even very dark ones", () => {
    for (const hex of [
      "#000000",
      "#1e3a8a",
      "#7f1d1d",
      "#16a34a",
      "#2563eb",
      "#f97316",
      "#ffffff",
    ]) {
      expect(contrastRatio(vividFill(hex), CARD_TEXT_COLOR)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("is more vivid than the old 34% tint for a mid-tone colour", () => {
    // Further from white = more colour.
    const distanceFromWhite = (hex: string) =>
      [1, 3, 5].reduce((sum, i) => sum + (255 - parseInt(hex.slice(i, i + 2), 16)), 0);
    expect(distanceFromWhite(vividFill("#2563eb"))).toBeGreaterThan(
      distanceFromWhite(lightTint("#2563eb", 0.34))
    );
  });

  it.each(FAMILY_COLOR_PALETTE.map((c) => [c.fill, c]))(
    "sub-division fill %s keeps card text at >= 4.5:1",
    (_fill, colour) => {
      expect(contrastRatio(colour.fill, CARD_TEXT_COLOR)).toBeGreaterThanOrEqual(4.5);
    }
  );
});

describe("buildSubdivisionShadeMap (shades of the department colour, 2026-10-02)", () => {
  it("gives each sub-division a different shade of its department's colour, deeper to lighter", () => {
    const map = buildSubdivisionShadeMap([
      { id: "product", departmentColor: "#3aa4e8" },
      { id: "project", departmentColor: "#3aa4e8" },
    ]);
    const product = map.get("product")!;
    const project = map.get("project")!;
    expect(product.fill).not.toBe(project.fill);
    expect(product.fill).toBe(shadeOf("#3aa4e8", -0.3));
    expect(project.fill).toBe(shadeOf("#3aa4e8", 0.45));
    // Both stay in the blue family: blue channel dominant.
    for (const hex of [product.fill, project.fill]) {
      const n = parseInt(hex.slice(1), 16);
      expect(n & 0xff).toBeGreaterThan((n >> 16) & 0xff);
    }
  });

  it("a department's only sub-division uses its exact colour", () => {
    expect(buildSubdivisionShadeMap([{ id: "qa", departmentColor: "#4FAE2F" }]).get("qa")).toEqual({
      fill: "#4fae2f",
      accent: "#4fae2f",
      text: cardTextColor("#4fae2f"),
    });
  });

  it("keeps text readable on every shade", () => {
    const map = buildSubdivisionShadeMap(
      ["a", "b", "c", "d"].map((id) => ({ id, departmentColor: "#1549b2" }))
    );
    for (const c of map.values()) {
      const best = Math.max(
        contrastRatio(c.fill, "#ffffff"),
        contrastRatio(c.fill, CARD_TEXT_COLOR)
      );
      expect(contrastRatio(c.fill, c.text!)).toBe(best);
    }
  });

  it("falls back to the palette when the department has no colour", () => {
    const map = buildSubdivisionShadeMap([{ id: "x", departmentColor: null }]);
    expect(map.get("x")).toEqual(FAMILY_COLOR_PALETTE[0]);
  });
});
