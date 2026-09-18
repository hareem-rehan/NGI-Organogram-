import { describe, expect, it } from "vitest";

import { escapeXmlText, wrapText } from "./svg-text";

describe("escapeXmlText", () => {
  it("escapes ampersands, less-than, and greater-than", () => {
    expect(escapeXmlText("Sales & Marketing")).toBe("Sales &amp; Marketing");
    expect(escapeXmlText("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;"
    );
  });

  it("escapes ampersand before angle brackets so nothing double-escapes", () => {
    expect(escapeXmlText("<a & b>")).toBe("&lt;a &amp; b&gt;");
  });

  it("leaves ordinary Unicode text untouched", () => {
    expect(escapeXmlText("José García — Ingénieur")).toBe("José García — Ingénieur");
  });

  it("neutralizes a foreignObject/script injection attempt embedded in a title", () => {
    const malicious = '"><foreignObject><script>alert(1)</script></foreignObject>';
    const escaped = escapeXmlText(malicious);
    expect(escaped).not.toContain("<foreignObject>");
    expect(escaped).not.toContain("<script>");
  });
});

describe("wrapText", () => {
  it("returns a single line for short text", () => {
    expect(wrapText("VP Engineering", 20, 2)).toEqual(["VP Engineering"]);
  });

  it("wraps onto a second line when it exceeds the per-line limit", () => {
    expect(wrapText("Senior Vice President Engineering", 25, 2)).toEqual([
      "Senior Vice President",
      "Engineering",
    ]);
  });

  it("truncates with an ellipsis when content still overflows maxLines", () => {
    const lines = wrapText(
      "A Very Long Title That Definitely Will Not Fit In Two Short Lines",
      15,
      2
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/…$/);
  });

  it("hard-breaks a single word longer than the line width", () => {
    const lines = wrapText("Supercalifragilisticexpialidocious", 10, 2);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.length <= 10)).toBe(true);
  });

  it("returns an empty array for empty/whitespace-only input", () => {
    expect(wrapText("", 20, 2)).toEqual([]);
    expect(wrapText("   ", 20, 2)).toEqual([]);
  });
});
