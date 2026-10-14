import { describe, expect, it } from "vitest";

import { occupantCardLines, occupantNamesOf } from "./organogram-occupants";

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
