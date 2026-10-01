import { describe, expect, it } from "vitest";

import {
  applyCardOffsets,
  departmentOrderAfterDrop,
  parseCardNodeKey,
} from "./organogram-card-offsets";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("parseCardNodeKey", () => {
  it("recognises position, department and sub-division keys", () => {
    expect(parseCardNodeKey(A)).toEqual({ kind: "position", positionId: A });
    expect(parseCardNodeKey(`dept:${A}`)).toEqual({ kind: "department", departmentId: A });
    expect(parseCardNodeKey(`subdiv:${A}:${B}`)).toEqual({
      kind: "subdivision",
      leadPositionId: A,
      jobFamilyId: B,
    });
  });

  it.each([
    ["an empty key", ""],
    ["a non-uuid", "ceo"],
    ["an unknown prefix", `team:${A}`],
    ["a sub-division key missing its family", `subdiv:${A}`],
    ["extra text", `${A} OR 1=1`],
  ])("rejects %s", (_label, key) => {
    expect(parseCardNodeKey(key)).toBeNull();
  });
});

describe("applyCardOffsets", () => {
  it("adds each saved offset and leaves other cards where the layout put them", () => {
    const placed = applyCardOffsets(
      new Map([
        ["a", { x: 10, y: 20 }],
        ["b", { x: 100, y: 20 }],
      ]),
      { a: { dx: 300, dy: -15 }, gone: { dx: 1, dy: 1 } }
    );
    expect(placed).toEqual(
      new Map([
        ["a", { x: 310, y: 5 }],
        ["b", { x: 100, y: 20 }],
      ])
    );
  });
});

describe("departmentOrderAfterDrop", () => {
  const row = ["cds", "hr", "fin", "mkt"];
  it("moves a box right onto a later box's place", () => {
    expect(departmentOrderAfterDrop(row, "cds", "fin")).toEqual(["hr", "fin", "cds", "mkt"]);
  });
  it("moves a box left onto an earlier box's place", () => {
    expect(departmentOrderAfterDrop(row, "mkt", "hr")).toEqual(["cds", "mkt", "hr", "fin"]);
  });
  it("leaves the order alone for itself or an id outside the row", () => {
    expect(departmentOrderAfterDrop(row, "hr", "hr")).toEqual(row);
    expect(departmentOrderAfterDrop(row, "hr", "it")).toEqual(row);
  });
});
