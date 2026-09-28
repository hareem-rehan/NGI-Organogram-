import { describe, expect, it } from "vitest";

import { computeElkLayout, DEPARTMENT_SIDE_PADDING, NODE_HEIGHT, NODE_WIDTH } from "./elk-layout";

describe("computeElkLayout", () => {
  it("returns an empty map for zero nodes", async () => {
    const result = await computeElkLayout([], []);
    expect(result.size).toBe(0);
  });

  it("places a child strictly below its parent (direction DOWN)", async () => {
    const positions = await computeElkLayout(
      ["root", "child"],
      [{ sourcePositionId: "root", targetPositionId: "child" }]
    );
    const root = positions.get("root")!;
    const child = positions.get("child")!;
    expect(child.y).toBeGreaterThan(root.y);
  });

  it("never overlaps two sibling nodes horizontally", async () => {
    const positions = await computeElkLayout(
      ["root", "a", "b"],
      [
        { sourcePositionId: "root", targetPositionId: "a" },
        { sourcePositionId: "root", targetPositionId: "b" },
      ]
    );
    const a = positions.get("a")!;
    const b = positions.get("b")!;
    const overlapsHorizontally = Math.abs(a.x - b.x) < NODE_WIDTH;
    const overlapsVertically = Math.abs(a.y - b.y) < NODE_HEIGHT;
    expect(overlapsHorizontally && overlapsVertically).toBe(false);
  });

  it("positions every requested node id exactly once, even with no edges (disconnected)", async () => {
    const positions = await computeElkLayout(["solo-a", "solo-b"], []);
    expect(positions.size).toBe(2);
    expect(positions.has("solo-a")).toBe(true);
    expect(positions.has("solo-b")).toBe(true);
  });

  it("is deterministic for the same input", async () => {
    const first = await computeElkLayout(
      ["root", "child"],
      [{ sourcePositionId: "root", targetPositionId: "child" }]
    );
    const second = await computeElkLayout(
      ["root", "child"],
      [{ sourcePositionId: "root", targetPositionId: "child" }]
    );
    expect(first.get("root")).toEqual(second.get("root"));
    expect(first.get("child")).toEqual(second.get("child"));
  });
});

describe("computeElkLayout — department segregation", () => {
  // CEO → Marketing (a short chain) and CEO → CDS / Engineering, where CDS's
  // chain ends in a WIDE fan-out (the shape that used to spill under
  // Engineering) and Engineering has its own wide fan-out.
  function chart() {
    const ids: string[] = ["ceo"];
    const edges: { sourcePositionId: string; targetPositionId: string }[] = [];
    const clusters = new Map<string, string>();
    const add = (id: string, parent: string, cluster: string) => {
      ids.push(id);
      edges.push({ sourcePositionId: parent, targetPositionId: id });
      clusters.set(id, cluster);
    };
    for (const dept of ["mkt", "cds", "eng"]) {
      add(dept, "ceo", dept);
      let tip = dept;
      for (let i = 0; i < 4; i++) {
        add(`${dept}-c${i}`, tip, dept);
        tip = `${dept}-c${i}`;
      }
      if (dept !== "mkt") {
        for (let k = 0; k < 5; k++) {
          add(`${dept}-f${k}`, tip, dept);
          add(`${dept}-f${k}-x`, `${dept}-f${k}`, dept);
        }
      }
    }
    return { ids, edges, clusters };
  }

  function bandOf(
    positions: Map<string, { x: number; y: number }>,
    clusters: Map<string, string>,
    cluster: string
  ) {
    const xs = [...clusters].filter(([, c]) => c === cluster).map(([id]) => positions.get(id)!.x);
    return { left: Math.min(...xs), right: Math.max(...xs) + NODE_WIDTH };
  }

  it("keeps each department's cards in its own band, with a clear gap between bands", async () => {
    const { ids, edges, clusters } = chart();
    const positions = await computeElkLayout(ids, edges, clusters);

    const bands = ["mkt", "cds", "eng"]
      .map((c) => ({ c, ...bandOf(positions, clusters, c) }))
      .sort((a, b) => a.left - b.left);
    for (let i = 1; i < bands.length; i++) {
      const gap = bands[i]!.left - bands[i - 1]!.right;
      // Wider than the 24px gap between two cards of the same department.
      expect(gap).toBeGreaterThanOrEqual(2 * DEPARTMENT_SIDE_PADDING);
    }
  });

  it("keeps the caller's department order, left to right", async () => {
    const { ids, edges, clusters } = chart();
    const positions = await computeElkLayout(ids, edges, clusters);
    const lefts = ["mkt", "cds", "eng"].map((c) => bandOf(positions, clusters, c).left);
    expect([...lefts].sort((a, b) => a - b)).toEqual(lefts);
  });

  it("returns absolute positions, with the root above every department", async () => {
    const { ids, edges, clusters } = chart();
    const positions = await computeElkLayout(ids, edges, clusters);
    expect(positions.size).toBe(ids.length);
    const rootY = positions.get("ceo")!.y;
    for (const id of ids.slice(1)) expect(positions.get(id)!.y).toBeGreaterThan(rootY);
    // A deep card sits below its own department heading, not at the origin.
    expect(positions.get("eng-f4-x")!.y).toBeGreaterThan(positions.get("eng")!.y);
  });

  it("centres the root over the row of departments", async () => {
    const { ids, edges, clusters } = chart();
    const positions = await computeElkLayout(ids, edges, clusters);
    const deptXs = ["mkt", "cds", "eng"].map((c) => positions.get(c)!.x);
    const expectedCentre = (Math.min(...deptXs) + Math.max(...deptXs) + NODE_WIDTH) / 2;
    expect(positions.get("ceo")!.x + NODE_WIDTH / 2).toBeCloseTo(expectedCentre, 5);
  });

  it("never overlaps two cards", async () => {
    const { ids, edges, clusters } = chart();
    const positions = await computeElkLayout(ids, edges, clusters);
    const boxes = ids.map((id) => positions.get(id)!);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const overlap =
          a.x < b.x + NODE_WIDTH &&
          b.x < a.x + NODE_WIDTH &&
          a.y < b.y + NODE_HEIGHT &&
          b.y < a.y + NODE_HEIGHT;
        expect(overlap).toBe(false);
      }
    }
  });
});
