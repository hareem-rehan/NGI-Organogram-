import { describe, expect, it } from "vitest";

import {
  compactTextStyle,
  effectiveTextStyle,
  fontFamilyById,
  fontScaleOf,
  fontWeightOf,
  isEmptyTextStyle,
  readableTextColor,
  textDecorationOf,
} from "./organogram-text-style";

describe("effectiveTextStyle", () => {
  it("lets a card's own settings win over the chart's, field by field", () => {
    expect(
      effectiveTextStyle(
        { fontFamily: "georgia", fontSize: 15, italic: true },
        { fontSize: 18, italic: null, color: "#ff0000" }
      )
    ).toEqual({ fontFamily: "georgia", fontSize: 18, italic: true, color: "#ff0000" });
  });

  it("is empty when nothing is customised", () => {
    expect(effectiveTextStyle(null, undefined)).toEqual({});
    expect(isEmptyTextStyle({ bold: null, color: undefined })).toBe(true);
    expect(isEmptyTextStyle({ bold: false })).toBe(false);
  });
});

describe("style helpers", () => {
  it("drops unset fields", () => {
    expect(compactTextStyle({ bold: false, italic: null, color: undefined })).toEqual({
      bold: false,
    });
  });

  it("scales from the built-in 13px title, clamped to 9–20px", () => {
    expect(fontScaleOf({})).toBe(1);
    expect(fontScaleOf({ fontSize: 26 })).toBeCloseTo(20 / 13);
    expect(fontScaleOf({ fontSize: 2 })).toBeCloseTo(9 / 13);
  });

  it("combines underline and strikethrough", () => {
    expect(textDecorationOf({})).toBeUndefined();
    expect(textDecorationOf({ underline: true })).toBe("underline");
    expect(textDecorationOf({ underline: true, strikethrough: true })).toBe(
      "underline line-through"
    );
  });

  it("bold on makes every line bold, off makes it regular, unset keeps the built-in weight", () => {
    expect(fontWeightOf({ bold: true }, 600)).toBe(700);
    expect(fontWeightOf({ bold: true }, 800)).toBe(800);
    expect(fontWeightOf({ bold: false }, 800)).toBe(400);
    expect(fontWeightOf({}, 600)).toBe(600);
  });

  it("maps every font to a PDF base family", () => {
    expect(fontFamilyById("georgia")?.exportFamily).toBe("Times");
    expect(fontFamilyById("courier")?.exportFamily).toBe("Courier");
    expect(fontFamilyById("verdana")?.exportFamily).toBe("Helvetica");
    expect(fontFamilyById("comic-sans")).toBeUndefined();
  });
});

describe("readableTextColor (2026-10-02)", () => {
  it("keeps a chosen colour that reads on the card (white on a mid-blue)", () => {
    expect(readableTextColor("#ffffff", "#3aa4e8", "#2d2d2d")).toBe("#ffffff");
  });

  it("switches to a readable colour where the chosen one would vanish", () => {
    // White text on a pale sub-division card, and on a neutral white card.
    expect(readableTextColor("#ffffff", "#d3f1b7", "#2d2d2d")).toBe("#2d2d2d");
    expect(readableTextColor("#ffffff", "#ffffff", "#2d2d2d")).toBe("#2d2d2d");
    // Dark text on a near-black card.
    expect(readableTextColor("#222222", "#0b1d4a", "#ffffff")).toBe("#ffffff");
  });

  it("uses the automatic colour when none is chosen", () => {
    expect(readableTextColor(null, "#3aa4e8", "#123456")).toBe("#123456");
  });
});
