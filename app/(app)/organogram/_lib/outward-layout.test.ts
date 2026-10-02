import { describe, expect, it } from "vitest";

import { NODE_WIDTH, computeElkLayout } from "./elk-layout";
import { arrangeBranchesOutward, growDirectionFor, layoutBranch } from "./outward-layout";

const W = 100;
const GAP = 10;
const e = (s: string, t: string) => ({ sourcePositionId: s, targetPositionId: t });

// dept → lead → (a, b, c), with a → (a1, a2)
const ids = ["dept", "lead", "a", "b", "c", "a1", "a2"];
const pos = new Map([
  ["dept", { x: 0, y: 0 }],
  ["lead", { x: 0, y: 100 }],
  ["a", { x: 0, y: 200 }],
  ["b", { x: 120, y: 200 }],
  ["c", { x: 240, y: 200 }],
  ["a1", { x: 0, y: 300 }],
  ["a2", { x: 120, y: 300 }],
]);
const edges = [
  e("dept", "lead"),
  e("lead", "a"),
  e("lead", "b"),
  e("lead", "c"),
  e("a", "a1"),
  e("a", "a2"),
];

function noOverlapsPerRow(placed: Map<string, { x: number; y: number }>, width: number) {
  const rows = new Map<number, number[]>();
  for (const p of placed.values()) rows.set(p.y, [...(rows.get(p.y) ?? []), p.x]);
  for (const xs of rows.values()) {
    xs.sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(width);
  }
}

describe("growDirectionFor", () => {
  it("left half grows left, right half grows right, the middle stays centred", () => {
    expect([0, 1, 2, 3, 4].map((i) => growDirectionFor(i, 5))).toEqual([
      "left",
      "left",
      "balanced",
      "right",
      "right",
    ]);
    expect([0, 1, 2, 3].map((i) => growDirectionFor(i, 4))).toEqual([
      "left",
      "left",
      "right",
      "right",
    ]);
    expect(growDirectionFor(0, 1)).toBe("balanced");
  });
});

describe("layoutBranch", () => {
  it("grows left: every manager sits above the right edge of its reports", () => {
    const { placed } = layoutBranch(ids, pos, edges, "left", W, GAP);
    const x = (id: string) => placed.get(id)!.x;
    expect(x("lead")).toBe(x("c")); // above its innermost (right-most) report
    expect(x("a")).toBe(x("a2"));
    expect(x("a1")).toBeLessThan(x("a")); // reports spread outward (left)
    for (const id of ["a", "b", "a1", "a2"]) expect(x(id)).toBeLessThanOrEqual(x("lead"));
    expect(x("a")).toBeLessThan(x("b")); // order kept
    expect(x("b")).toBeLessThan(x("c"));
    noOverlapsPerRow(placed, W);
  });

  it("grows right: the mirror image", () => {
    const { placed } = layoutBranch(ids, pos, edges, "right", W, GAP);
    const x = (id: string) => placed.get(id)!.x;
    expect(x("lead")).toBe(x("a")); // above its innermost (left-most) report
    for (const id of ["b", "c", "a2"]) expect(x(id)).toBeGreaterThanOrEqual(x("lead"));
    noOverlapsPerRow(placed, W);
  });

  it("balanced: each manager centred over its reports", () => {
    const { placed } = layoutBranch(ids, pos, edges, "balanced", W, GAP);
    const x = (id: string) => placed.get(id)!.x;
    expect(x("lead")).toBe((x("a") + x("c")) / 2);
    noOverlapsPerRow(placed, W);
  });

  it("keeps every card's row", () => {
    const { placed } = layoutBranch(ids, pos, edges, "left", W, GAP);
    for (const id of ids) expect(placed.get(id)!.y).toBe(pos.get(id)!.y);
  });

  it("places a two-head card under the head on the row just above it", () => {
    const twoHead = new Map(pos).set("x", { x: 0, y: 300 });
    const { placed } = layoutBranch(
      [...ids, "x"],
      twoHead,
      [...edges, e("lead", "x"), e("b", "x")],
      "right",
      W,
      GAP
    );
    expect(placed.get("x")!.x).toBe(placed.get("b")!.x);
  });
});

describe("arrangeBranchesOutward", () => {
  it("packs branches in their order without overlapping, each growing its own way", () => {
    const two = new Map([
      ["L", { x: 0, y: 0 }],
      ["L1", { x: 0, y: 100 }],
      ["L2", { x: 120, y: 100 }],
      ["R", { x: 500, y: 0 }],
      ["R1", { x: 500, y: 100 }],
      ["R2", { x: 620, y: 100 }],
    ]);
    const out = arrangeBranchesOutward(
      two,
      [
        ["L", "L1", "L2"],
        ["R", "R1", "R2"],
      ],
      [e("L", "L1"), e("L", "L2"), e("R", "R1"), e("R", "R2")],
      W,
      GAP,
      50
    );
    const x = (id: string) => out.get(id)!.x;
    expect(x("L")).toBe(x("L2")); // left branch: head over its right edge
    expect(x("R")).toBe(x("R1")); // right branch: head over its left edge
    expect(x("R1") - (x("L2") + W)).toBeGreaterThanOrEqual(50);
  });
});

describe("computeElkLayout — outward branches (end to end)", () => {
  it("the left-most department grows left and the right-most grows right of its box", async () => {
    const nodeIds = ["ceo", "dL", "dM", "dR", "l1", "l2", "m1", "r1", "r2"];
    const edgesE = [
      e("ceo", "dL"),
      e("ceo", "dM"),
      e("ceo", "dR"),
      e("dL", "l1"),
      e("dL", "l2"),
      e("dM", "m1"),
      e("dR", "r1"),
      e("dR", "r2"),
    ];
    const clusterOf = new Map([
      ["dL", "dL"],
      ["l1", "dL"],
      ["l2", "dL"],
      ["dM", "dM"],
      ["m1", "dM"],
      ["dR", "dR"],
      ["r1", "dR"],
      ["r2", "dR"],
    ]);
    const p = await computeElkLayout(nodeIds, edgesE, clusterOf);
    const x = (id: string) => p.get(id)!.x;
    expect(Math.max(x("l1"), x("l2"))).toBe(x("dL"));
    expect(Math.min(x("l1"), x("l2"))).toBeLessThan(x("dL"));
    expect(Math.min(x("r1"), x("r2"))).toBe(x("dR"));
    expect(Math.max(x("r1"), x("r2"))).toBeGreaterThan(x("dR"));
    // The CEO stays centred over the department row.
    expect(x("ceo") + NODE_WIDTH / 2).toBeCloseTo((x("dL") + x("dR") + NODE_WIDTH) / 2, 0);
  });
});
