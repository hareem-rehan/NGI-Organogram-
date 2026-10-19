import { describe, expect, it } from "vitest";

import {
  CARD_METRICS,
  CARD_WIDTH,
  MAX_TITLE_LINES,
  cardSizeFor,
  MAX_EXPANDED_CARD_WIDTH,
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

  it("grows by one line per name line when several people hold the role (D56)", () => {
    const one = cardSizeFor({ ...position, occupantName: "Ali", occupantLines: 1 });
    const three = cardSizeFor({ ...position, occupantName: "Ali", occupantLines: 3 });
    expect(three.height - one.height).toBeGreaterThan(2 * 14);
    expect(three.width).toBe(one.width);
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
    const base = cardSizeFor({ ...position, title: "Head of Ventures" });
    const big = cardSizeFor({ ...position, title: "Head of Ventures" }, { fontSize: 20 });
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

describe("expanded names (user request, 2026-10-19)", () => {
  it("widens the card for a long name, up to a cap", () => {
    const base = { title: "Tech Lead", departmentName: "Engineering", roleCount: 0 };
    const short = cardSizeFor({ ...base, occupantLines: 6, expandedOccupantNames: ["Ali"] });
    const long = cardSizeFor({
      ...base,
      occupantLines: 6,
      expandedOccupantNames: ["Muhammad Owais Hassan Zaidi Siddiqui"],
    });
    const huge = cardSizeFor({
      ...base,
      occupantLines: 6,
      expandedOccupantNames: ["A".repeat(120)],
    });
    expect(short.width).toBe(CARD_WIDTH);
    expect(long.width).toBeGreaterThan(CARD_WIDTH);
    expect(huge.width).toBe(MAX_EXPANDED_CARD_WIDTH);
  });
});

describe("a word too wide for the card (D53)", () => {
  it("widens the card just enough for the word instead of clipping it", () => {
    const heading = cardSizeFor(
      {
        kind: "department",
        title: "",
        departmentName: "Delivery Org / Administration",
        roleCount: 3,
        hasChildren: true,
      },
      { fontSize: 15 }
    );
    expect(heading.width).toBeGreaterThan(CARD_WIDTH);
    const normal = cardSizeFor({
      kind: "department",
      title: "",
      departmentName: "Human Resources",
      roleCount: 3,
      hasChildren: true,
    });
    expect(normal.width).toBe(CARD_WIDTH);
  });
});

describe("titles measured as they are drawn (client report, 2026-10-19)", () => {
  const card = (title: string, style: Parameters<typeof cardSizeFor>[1]) =>
    cardSizeFor({ title, departmentName: "Engineering", roleCount: 2, hasChildren: true }, style);

  it("measures in the text style's weight: a title that needs two lines in bold fits one in regular", () => {
    expect(card("Associate Architect", { fontSize: 16 }).titleLines).toBe(2);
    expect(card("Associate Architect", { fontSize: 16, bold: false }).titleLines).toBe(1);
    expect(card("Associate Architect", { fontSize: 16, bold: false }).height).toBeLessThan(
      card("Associate Architect", { fontSize: 16 }).height
    );
  });

  it.each([
    "Principal QA Engineer",
    "Associate Lead UI/UX",
    "Sr. Software Engineer",
    "Associate Tech Lead",
  ])(
    "includes the titles' tight letter spacing: '%s' fits one line (Arial 15, regular)",
    (title) => {
      expect(card(title, { fontFamily: "arial", fontSize: 15, bold: false }).titleLines).toBe(1);
    }
  );
});

describe("department and sub-division boxes show their whole name (client request, 2026-10-20)", () => {
  const name = "Backend (MERN, LAMP, AI/ML, DS, Python, Full Stack)";

  it("a long sub-division name wraps onto as many lines as it needs, and the box grows", () => {
    const short = cardSizeFor({
      kind: "subdivision",
      title: "DE",
      departmentName: "Engineering",
      roleCount: 14,
      hasChildren: true,
    });
    const long = cardSizeFor({
      kind: "subdivision",
      title: name,
      departmentName: "Engineering",
      roleCount: 14,
      hasChildren: true,
    });
    expect(long.titleLines).toBeGreaterThan(MAX_TITLE_LINES);
    expect(long.height).toBeGreaterThan(short.height + (long.titleLines - 1) * 14);
  });

  it("the wrapped lines hold the whole name, with no '…'", () => {
    const size = cardSizeFor({
      kind: "subdivision",
      title: name,
      departmentName: "Engineering",
      roleCount: 14,
      hasChildren: true,
    });
    const m = CARD_METRICS;
    // The same room the box (and the export) gives the name.
    const room = size.width - 2 * m.border - 2 * m.headingPadX - m.headingChevron - 4;
    const lines = wrapToWidth(name, room, 13, size.titleLines, { bold: true });
    expect(lines.join(" ")).not.toContain("…");
  });

  it("position cards are unchanged: still at most three title lines", () => {
    const size = cardSizeFor({ ...position, title: `${name} ${name} ${name}` });
    expect(size.titleLines).toBe(MAX_TITLE_LINES);
  });
});
