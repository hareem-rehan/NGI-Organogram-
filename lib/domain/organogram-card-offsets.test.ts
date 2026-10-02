import { describe, expect, it } from "vitest";

import {
  applyCardOffsets,
  departmentOrderAfterDrop,
  parseCardNodeKey,
  placeCards,
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

describe("placeCards / resolveOverlaps (cards never overlap)", () => {
  const size = { width: 100, height: 50 };
  const overlapping = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    a.x < b.x + 100 && b.x < a.x + 100 && a.y < b.y + 50 && b.y < a.y + 50;

  it("nudges a placed card off a card it would land on, to the nearer side", () => {
    // HR's saved offset was right while its neighbour was wide; after a
    // collapse its automatic spot moved and the offset lands it on CDS.
    const auto = new Map([
      ["cds", { x: 0, y: 0 }],
      ["hr", { x: 120, y: 0 }],
    ]);
    const out = placeCards(auto, { hr: { dx: -100, dy: 20 } }, size, 20);
    expect(out.get("cds")).toEqual({ x: 0, y: 0 }); // unplaced cards never move
    expect(overlapping(out.get("hr")!, out.get("cds")!)).toBe(false);
    expect(out.get("hr")).toEqual({ x: 120, y: 20 }); // right was nearer than left
  });

  it("leaves a placed card alone when it is clear", () => {
    const auto = new Map([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 500, y: 0 }],
    ]);
    expect(placeCards(auto, { b: { dx: 40, dy: 300 } }, size, 20).get("b")).toEqual({
      x: 540,
      y: 300,
    });
  });

  it("never leaves any two cards overlapping, even in a crowded row", () => {
    const auto = new Map(
      Array.from({ length: 6 }, (_, i) => [`c${i}`, { x: i * 120, y: 0 }] as const)
    );
    const offsets = { c1: { dx: -110, dy: 0 }, c3: { dx: -230, dy: 10 }, c5: { dx: -480, dy: 5 } };
    const out = placeCards(auto, offsets, size, 20);
    const ps = [...out.values()];
    for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++) expect(overlapping(ps[i]!, ps[j]!)).toBe(false);
  });
});
