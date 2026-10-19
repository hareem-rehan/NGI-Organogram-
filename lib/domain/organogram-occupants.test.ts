import { describe, expect, it } from "vitest";

import { occupantCardLines, occupantCardView, occupantNamesOf } from "./organogram-occupants";

describe("occupantCardLines (D56)", () => {
  it("names up to three people, one per line", () => {
    expect(occupantCardLines([])).toEqual([]);
    expect(occupantCardLines(["Ali"])).toEqual(["Ali"]);
    expect(occupantCardLines(["Ali", "Sara", "Omar"])).toEqual(["Ali", "Sara", "Omar"]);
  });
  it("names the first two and counts the rest beyond three", () => {
    expect(occupantCardLines(["Ali", "Sara", "Omar", "Hina", "Zain"])).toEqual([
      "Ali",
      "Sara",
      "+3 more",
    ]);
  });
});

describe("occupantCardView (on-screen card, expandable)", () => {
  const five = ["Ali", "Sara", "Omar", "Hina", "Zain"];
  it("shows the one name and no toggle for a single person", () => {
    expect(occupantCardView(["Ali"], false)).toEqual({ names: ["Ali"], toggle: null });
    expect(occupantCardView([], false)).toEqual({ names: [], toggle: null });
  });
  it("closed: the first name and a '+N Show Names' toggle, from two people up", () => {
    expect(occupantCardView(["Ali", "Sara"], false)).toEqual({
      names: ["Ali"],
      toggle: "+1 Show Names",
    });
    expect(occupantCardView(five, false)).toEqual({ names: ["Ali"], toggle: "+4 Show Names" });
  });
  it("opened: every name and a 'Hide Names' toggle", () => {
    expect(occupantCardView(five, true)).toEqual({ names: five, toggle: "Hide Names" });
  });
});

describe("occupantNamesOf", () => {
  it("is empty for a vacant position", () => {
    expect(
      occupantNamesOf({
        occupancyStatus: "vacant",
        occupantDisplayName: null,
        occupantDisplayNames: [],
      })
    ).toEqual([]);
  });
  it("uses the full list, falling back to the single name for older data", () => {
    expect(
      occupantNamesOf({
        occupancyStatus: "occupied",
        occupantDisplayName: "Ali",
        occupantDisplayNames: ["Ali", "Sara"],
      })
    ).toEqual(["Ali", "Sara"]);
    expect(occupantNamesOf({ occupancyStatus: "occupied", occupantDisplayName: "Ali" })).toEqual([
      "Ali",
    ]);
  });
});
