import { describe, expect, it } from "vitest";

import {
  compactTextStyle,
  effectiveTextStyle,
  fontFamilyById,
  fontScaleOf,
  fontWeightOf,
  isEmptyTextStyle,
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
