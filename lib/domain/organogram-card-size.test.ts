import { describe, expect, it } from "vitest";

import {
  CARD_WIDTH,
  MAX_TITLE_LINES,
  cardSizeFor,
  equalizeRowHeights,
  measureTextWidth,
  wrapToWidth,
} from "./organogram-card-size";

const position = { title: "CFO", departmentName: "Finance", roleCount: 5, hasChildren: true };

describe("measureTextWidth", () => {
  it("grows with length, size, boldness and capitals", () => {
    expect(measureTextWidth("CFO", 13)).toBeGreaterThan(0);
    expect(measureTextWidth("CFO Office", 13)).toBeGreaterThan(measureTextWidth("CFO", 13));
    expect(measureTextWidth("Audit", 20)).toBeGreaterThan(measureTextWidth("Audit", 13));
    expect(measureTextWidth("Audit", 13, { bold: true })).toBeGreaterThan(
      measureTextWidth("Audit", 13)
    );
    expect(measureTextWidth("audit", 13, { uppercase: true })).toBe(measureTextWidth("AUDIT", 13));
  });
});

describe("wrapToWidth", () => {
  it("keeps text that fits on one line", () => {
    expect(wrapToWidth("Head of Audit", 500, 13, 2)).toEqual(["Head of Audit"]);
  });

  it("wraps at words and ends the last line in … when text remains", () => {
    const lines = wrapToWidth("Associate Director of Strategic Partnerships", 120, 13, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]!.endsWith("…")).toBe(true);
    for (const line of lines) expect(measureTextWidth(line, 13)).toBeLessThanOrEqual(120);
  });

  it("shortens a single word wider than the line", () => {
    const [line] = wrapToWidth("Supercalifragilisticexpialidocious", 80, 13, 1);
    expect(line!.endsWith("…")).toBe(true);
    expect(measureTextWidth(line!, 13)).toBeLessThanOrEqual(80);
  });

  it("returns nothing for empty text", () => {
    expect(wrapToWidth("   ", 100, 13, 2)).toEqual([]);
  });
});

describe("cardSizeFor", () => {
  it("keeps the standard width and a compact height for short text", () => {
    const size = cardSizeFor(position);
    expect(size.width).toBe(CARD_WIDTH);
    expect(size.height).toBeLessThan(60);
    expect(size.titleLines).toBe(1);
  });

  it("adds a line's height for the person in the role", () => {
    const empty = cardSizeFor(position);
    const filled = cardSizeFor({ ...position, occupantName: "Farzal Dhojki" });
    expect(filled.height - empty.height).toBeGreaterThan(14);
  });

  it("keeps one width and wraps a long title onto more lines, growing taller (D49)", () => {
    const short = cardSizeFor(position);
    const two = cardSizeFor({ ...position, title: "Principal Software Engineer II" });
    expect(two.width).toBe(CARD_WIDTH);
    expect(two.titleLines).toBe(2);
    expect(two.height).toBeGreaterThan(short.height);

    const longest = cardSizeFor({
      ...position,
      title: "Associate Director of Strategic Partnerships and Enterprise Client Success",
    });
    expect(longest.width).toBe(CARD_WIDTH);
    expect(longest.titleLines).toBe(MAX_TITLE_LINES);
    expect(longest.height).toBeGreaterThan(two.height);
  });

  it("grows with a larger text size", () => {
    const base = cardSizeFor({ ...position, title: "VP Startup and Ventures" });
    const big = cardSizeFor({ ...position, title: "VP Startup and Ventures" }, { fontSize: 20 });
    expect(big.height).toBeGreaterThan(base.height);
    expect(big.width).toBe(base.width); // wraps rather than widening
    expect(big.titleLines).toBeGreaterThan(base.titleLines);
  });

  it("sizes a department heading for its uppercase name", () => {
    const size = cardSizeFor({
      kind: "department",
      title: "",
      departmentName: "Delivery Org / Administration",
      roleCount: 0,
    });
    expect(size.width).toBe(CARD_WIDTH);
    expect(size.titleLines).toBe(2); // "DELIVERY ORG / ADMINISTRATION" wraps
    expect(size.height).toBeLessThan(80);
  });
});

describe("equalizeRowHeights", () => {
  it("gives cards on the same row the row's tallest height, and keeps widths", () => {
    const sizes = new Map([
      ["a", { width: 188, height: 53, titleLines: 1 }],
      ["b", { width: 240, height: 71, titleLines: 1 }],
      ["c", { width: 188, height: 53, titleLines: 1 }],
    ]);
    const positions = new Map([
      ["a", { x: 0, y: 100 }],
      ["b", { x: 240, y: 100 }],
      ["c", { x: 0, y: 300 }],
    ]);
    const out = equalizeRowHeights(positions, sizes);
    expect(out.get("a")).toEqual({ width: 188, height: 71, titleLines: 1 });
    expect(out.get("b")!.height).toBe(71);
    expect(out.get("c")!.height).toBe(53);
  });
});
