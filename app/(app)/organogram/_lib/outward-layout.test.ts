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
  it("centres every manager over its reports, whichever side the branch is on (D48)", () => {
    for (const direction of ["left", "right", "balanced"] as const) {
      const { placed } = layoutBranch(ids, pos, edges, direction, W, GAP);
      const x = (id: string) => placed.get(id)!.x;
      expect(x("lead")).toBe((x("a") + x("c")) / 2);
      expect(x("a")).toBe((x("a1") + x("a2")) / 2);
      expect(x("dept")).toBe(x("lead")); // one report: straight below
      expect(x("a")).toBeLessThan(x("b")); // order kept
      expect(x("b")).toBeLessThan(x("c"));
      noOverlapsPerRow(placed, W);
    }
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

describe("layoutBranch with each card's own width (D47)", () => {
  const widths: Record<string, number> = {
    dept: 100,
    lead: 180,
    a: 100,
    b: 260,
    c: 100,
    a1: 140,
    a2: 100,
  };
  const widthOf = (id: string) => widths[id]!;

  it("never overlaps cards of different widths on a row", () => {
    for (const direction of ["left", "right", "balanced"] as const) {
      const { placed } = layoutBranch(ids, pos, edges, direction, widthOf, GAP);
      const rows = new Map<number, string[]>();
      for (const [id, p] of placed) rows.set(p.y, [...(rows.get(p.y) ?? []), id]);
      for (const row of rows.values()) {
        row.sort((x, y) => placed.get(x)!.x - placed.get(y)!.x);
        for (let i = 1; i < row.length; i++) {
          const prev = row[i - 1]!;
          expect(placed.get(row[i]!)!.x).toBeGreaterThanOrEqual(
            placed.get(prev)!.x + widthOf(prev)
          );
        }
      }
    }
  });

  it("centres a manager over reports of different widths (D48)", () => {
    const centre = (placed: Map<string, { x: number }>, id: string) =>
      placed.get(id)!.x + widthOf(id) / 2;
    const { placed } = layoutBranch(ids, pos, edges, "left", widthOf, GAP);
    expect(centre(placed, "lead")).toBe((centre(placed, "a") + centre(placed, "c")) / 2);
    expect(centre(placed, "a")).toBe((centre(placed, "a1") + centre(placed, "a2")) / 2);
    expect(centre(placed, "dept")).toBe(centre(placed, "lead"));
  });

  it("centres a two-head card and the chain below it between both heads", () => {
    // ad → (l1 → l2) and (r1 → r2); both l2 and r2 head "join" → "j2".
    const jIds = ["ad", "l1", "l2", "r1", "r2", "join", "j2"];
    const jPos = new Map([
      ["ad", { x: 0, y: 0 }],
      ["l1", { x: 0, y: 100 }],
      ["r1", { x: 120, y: 100 }],
      ["l2", { x: 0, y: 200 }],
      ["r2", { x: 120, y: 200 }],
      ["join", { x: 0, y: 300 }],
      ["j2", { x: 0, y: 400 }],
    ]);
    const jEdges = [
      e("ad", "l1"),
      e("ad", "r1"),
      e("l1", "l2"),
      e("r1", "r2"),
      e("l2", "join"),
      e("r2", "join"),
      e("join", "j2"),
    ];
    const { placed } = layoutBranch(jIds, jPos, jEdges, "left", W, GAP);
    const x = (id: string) => placed.get(id)!.x;
    expect(x("join")).toBe((x("l2") + x("r2")) / 2);
    expect(x("j2")).toBe(x("join")); // the chain below stays straight
    expect(x("ad")).toBe((x("l1") + x("r1")) / 2);
  });

  it("keeps a straight single-report chain of different widths on one vertical line", () => {
    const chainIds = ["p", "q", "r"];
    const chainPos = new Map([
      ["p", { x: 0, y: 0 }],
      ["q", { x: 0, y: 100 }],
      ["r", { x: 0, y: 200 }],
    ]);
    const w: Record<string, number> = { p: 300, q: 150, r: 220 };
    for (const direction of ["left", "right", "balanced"] as const) {
      const { placed } = layoutBranch(
        chainIds,
        chainPos,
        [e("p", "q"), e("q", "r")],
        direction,
        (id) => w[id]!,
        GAP
      );
      const centres = chainIds.map((id) => placed.get(id)!.x + w[id]! / 2);
      expect(new Set(centres).size).toBe(1);
      expect(Math.min(...chainIds.map((id) => placed.get(id)!.x))).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("arrangeBranchesOutward", () => {
  it("packs branches in their order without overlapping", () => {
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
    expect(x("L")).toBe((x("L1") + x("L2")) / 2); // each head centred over its reports (D48)
    expect(x("R")).toBe((x("R1") + x("R2")) / 2);
    expect(x("R1") - (x("L2") + W)).toBeGreaterThanOrEqual(50);
  });
});

describe("computeElkLayout — outward branches (end to end)", () => {
  it("centres each department box over its reports, departments in order", async () => {
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
    // Each department box is centred over its two reports (D48).
    expect(x("dL")).toBe((x("l1") + x("l2")) / 2);
    expect(x("dR")).toBe((x("r1") + x("r2")) / 2);
    expect(x("dM")).toBe(x("m1"));
    // The CEO stays centred over the department row.
    expect(x("ceo") + NODE_WIDTH / 2).toBeCloseTo((x("dL") + x("dR") + NODE_WIDTH) / 2, 0);
  });
});
