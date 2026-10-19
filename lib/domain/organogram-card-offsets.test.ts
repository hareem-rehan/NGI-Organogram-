import { describe, expect, it } from "vitest";

import {
  ROW_SNAP_PX,
  snapMoveToRow,
  applyCardOffsets,
  departmentOrderAfterDrop,
  isGroupingNodeKey,
  orderAfterDropAt,
  parseCardNodeKey,
  placeCards,
  resolveGroupOverlaps,
  reorderWithinSlots,
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

describe("orderAfterDropAt (D55)", () => {
  const row = [
    { id: "cds", centerX: 100 },
    { id: "hr", centerX: 300 },
    { id: "fin", centerX: 500 },
    { id: "mkt", centerX: 700 },
  ];
  it("puts the box before the first sibling to the right of the drop", () => {
    // Client Delivery Services let go between Finance and Marketing → third.
    expect(orderAfterDropAt(row, "cds", 600)).toEqual(["hr", "fin", "cds", "mkt"]);
  });
  it("moves a box to the very front or the very end", () => {
    expect(orderAfterDropAt(row, "fin", 0)).toEqual(["fin", "cds", "hr", "mkt"]);
    expect(orderAfterDropAt(row, "cds", 5000)).toEqual(["hr", "fin", "mkt", "cds"]);
  });
  it("keeps the order when the box is let go near where it was", () => {
    expect(orderAfterDropAt(row, "hr", 320)).toEqual(["cds", "hr", "fin", "mkt"]);
  });
  it("leaves the row alone for an id that is not in it", () => {
    expect(orderAfterDropAt(row, "it", 0)).toEqual(["cds", "hr", "fin", "mkt"]);
  });
});

describe("reorderWithinSlots (D55)", () => {
  it("swaps only the given ids among the slots they held", () => {
    expect(reorderWithinSlots(["a", "b", "c", "d", "e"], ["d", "b"])).toEqual([
      "a",
      "d",
      "c",
      "b",
      "e",
    ]);
  });
  it("ignores ids outside the list and keeps everything else in place", () => {
    expect(reorderWithinSlots(["a", "b", "c"], ["x", "c", "a"])).toEqual(["c", "b", "a"]);
  });
});

describe("isGroupingNodeKey (D55)", () => {
  it("is true for department and sub-division boxes only", () => {
    expect(isGroupingNodeKey(`dept:${A}`)).toBe(true);
    expect(isGroupingNodeKey(`subdiv:${A}:${B}`)).toBe(true);
    expect(isGroupingNodeKey(A)).toBe(false);
    expect(isGroupingNodeKey("not-a-key")).toBe(false);
  });
});

describe("resolveGroupOverlaps (D62)", () => {
  const size = { width: 100, height: 50 };
  it("moves a group that lands on another card aside as one piece, keeping its shape", () => {
    const positions = new Map([
      ["other", { x: 0, y: 0 }],
      ["head", { x: 30, y: 0 }], // overlaps "other"
      ["child", { x: 30, y: 100 }],
    ]);
    const out = resolveGroupOverlaps(positions, [["head", "child"]], size, 20);
    const head = out.get("head")!;
    const child = out.get("child")!;
    // No overlap with the static card any more…
    expect(head.x >= 0 + 100 + 10 || head.x + 100 <= 0 - 10).toBe(true);
    // …and the branch kept its shape (same shift for both).
    expect(child.x - head.x).toBe(0);
    expect(child.y - head.y).toBe(100);
    expect(out.get("other")).toEqual({ x: 0, y: 0 });
  });

  it("leaves a group alone when it overlaps nothing", () => {
    const positions = new Map([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 500, y: 0 }],
      ["b1", { x: 500, y: 100 }],
    ]);
    expect(resolveGroupOverlaps(positions, [["b", "b1"]], size, 20)).toEqual(positions);
  });
});

describe("placeCards groups cards by their shared shift (D62)", () => {
  it("cards moved together stay together when nudged", () => {
    const positions = new Map([
      ["static", { x: 300, y: 0 }],
      ["head", { x: 0, y: 0 }],
      ["child", { x: 0, y: 100 }],
    ]);
    // The branch was moved right by 300 — onto the static card.
    const out = placeCards(
      positions,
      { head: { dx: 300, dy: 0 }, child: { dx: 300, dy: 0 } },
      { width: 100, height: 50 },
      20
    );
    expect(out.get("child")!.x).toBe(out.get("head")!.x);
    expect(out.get("static")).toEqual({ x: 300, y: 0 });
    expect(out.get("head")!.x).not.toBe(300);
  });
});

describe("snapMoveToRow (client report 2026-10-20)", () => {
  it("a small wobble lands back on the row", () => {
    expect(snapMoveToRow(0, 9)).toBe(0);
    expect(snapMoveToRow(0, -(ROW_SNAP_PX - 1))).toBe(0);
  });
  it("a card already off its row snaps back when moved near it", () => {
    expect(snapMoveToRow(60, -50)).toBe(-60);
  });
  it("a real move up or down is kept", () => {
    expect(snapMoveToRow(0, 90)).toBe(90);
    expect(snapMoveToRow(0, -ROW_SNAP_PX)).toBe(-ROW_SNAP_PX);
  });
});
