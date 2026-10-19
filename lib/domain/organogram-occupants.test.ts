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
  it("shows up to three names and no toggle", () => {
    expect(occupantCardView(["Ali", "Sara", "Omar"], false)).toEqual({
      names: ["Ali", "Sara", "Omar"],
      toggle: null,
    });
  });
  it("collapsed: two names and a '+N more' toggle", () => {
    expect(occupantCardView(five, false)).toEqual({ names: ["Ali", "Sara"], toggle: "+3 more" });
  });
  it("expanded: every name and a 'Show fewer' toggle", () => {
    expect(occupantCardView(five, true)).toEqual({ names: five, toggle: "Show fewer" });
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
