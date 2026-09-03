import { describe, expect, it } from "vitest";

import {
  buildReportingPath,
  calculateLevel,
  findCycleInGraph,
  HierarchyDepthExceededError,
  MAX_HIERARCHY_DEPTH,
  recalculateSubtreeLevels,
  ROOT_LEVEL,
  wouldCreateCycle,
} from "./hierarchy";

describe("calculateLevel", () => {
  it("assigns ROOT_LEVEL when there is no parent", () => {
    expect(calculateLevel(null)).toBe(ROOT_LEVEL);
    expect(ROOT_LEVEL).toBe(1);
  });

  it("is always parent level + 1", () => {
    expect(calculateLevel(1)).toBe(2);
    expect(calculateLevel(9)).toBe(10);
  });
});

describe("wouldCreateCycle", () => {
  it("detects self-reporting (the position is the first element of its own proposed chain)", () => {
    expect(wouldCreateCycle("A", ["A", "root"])).toBe(true);
  });

  it("detects a direct two-position cycle", () => {
    // Proposing that A report to B, where B's own chain is [B, A, root].
    expect(wouldCreateCycle("A", ["B", "A", "root"])).toBe(true);
  });

  it("detects a deep indirect cycle", () => {
    expect(wouldCreateCycle("A", ["D", "C", "B", "A", "root"])).toBe(true);
  });

  it("allows a proposed parent that is not in the position's own ancestry", () => {
    expect(wouldCreateCycle("A", ["Z", "Y", "root"])).toBe(false);
  });

  it("allows attaching to the root itself when the root is not the position", () => {
    expect(wouldCreateCycle("A", ["root"])).toBe(false);
  });
});

describe("buildReportingPath", () => {
  it("reverses a self-to-root chain into a root-first breadcrumb", () => {
    const chain = [
      { id: "leaf", title: "IC", organizationalLevel: 3 },
      { id: "mid", title: "Manager", organizationalLevel: 2 },
      { id: "root", title: "CEO", organizationalLevel: 1 },
    ];
    expect(buildReportingPath(chain).map((n) => n.title)).toEqual(["CEO", "Manager", "IC"]);
  });

  it("does not mutate the input array", () => {
    const chain = [{ id: "a", title: "A", organizationalLevel: 1 }];
    const result = buildReportingPath(chain);
    expect(result).not.toBe(chain);
  });
});

describe("recalculateSubtreeLevels", () => {
  it("assigns the subtree root the correct level under its new parent", () => {
    const levels = recalculateSubtreeLevels("root", 5, []);
    expect(levels.get("root")).toBe(6);
  });

  it("propagates levels down a multi-branch subtree", () => {
    const subtree = [
      { id: "child1", parentId: "root", currentLevel: 99 },
      { id: "child2", parentId: "root", currentLevel: 99 },
      { id: "grandchild", parentId: "child1", currentLevel: 99 },
    ];
    const levels = recalculateSubtreeLevels("root", null, subtree);
    expect(levels.get("root")).toBe(1);
    expect(levels.get("child1")).toBe(2);
    expect(levels.get("child2")).toBe(2);
    expect(levels.get("grandchild")).toBe(3);
  });

  it("handles a legitimately very deep (but valid, acyclic) chain without error", () => {
    // A real single-parent chain terminates in O(n) BFS steps regardless
    // of depth — no stack recursion is involved, so depth alone is not
    // pathological. This proves the function scales past ordinary org
    // depths without hitting the defensive guard below.
    const depth = MAX_HIERARCHY_DEPTH + 50;
    const subtree = Array.from({ length: depth }, (_, i) => ({
      id: `n${i + 1}`,
      parentId: i === 0 ? "root" : `n${i}`,
      currentLevel: 99,
    }));
    const levels = recalculateSubtreeLevels("root", null, subtree);
    expect(levels.get(`n${depth}`)).toBe(depth + 1);
  });

  it("throws HierarchyDepthExceededError on genuinely corrupted, cyclic subtree data", () => {
    // This pure function trusts its input's parent/child edges; it does
    // not itself re-derive them from a cycle-safe source. If it were ever
    // fed corrupted data containing a cycle (which docs/DOMAIN_MODEL.md
    // §7 and write-time cycle prevention should make unreachable through
    // any normal code path), it must fail loudly rather than loop forever.
    // Constructed here via a duplicate node id forming a mutual A<->B
    // reference, both reachable from the root.
    const corruptedSubtree = [
      { id: "A", parentId: "root", currentLevel: 99 },
      { id: "B", parentId: "A", currentLevel: 99 },
      { id: "A", parentId: "B", currentLevel: 99 }, // duplicate "A" entry closes the cycle
    ];
    expect(() => recalculateSubtreeLevels("root", null, corruptedSubtree)).toThrow(
      HierarchyDepthExceededError
    );
  });
});

describe("findCycleInGraph", () => {
  it("returns null for an acyclic tree (a normal, valid hierarchy)", () => {
    const parentOf = new Map<string, string | null>([
      ["root", null],
      ["A", "root"],
      ["B", "root"],
      ["C", "A"],
    ]);
    expect(findCycleInGraph(parentOf)).toBeNull();
  });

  it("returns null for a graph with no edges at all", () => {
    expect(findCycleInGraph(new Map())).toBeNull();
  });

  it("detects a direct two-node cycle (A->B, B->A) even though each edge alone looks fine", () => {
    // This is exactly the "two individually valid manager changes forming
    // a cycle together" combined-state scenario CSV import must catch —
    // neither row is invalid in isolation.
    const parentOf = new Map<string, string | null>([
      ["A", "B"],
      ["B", "A"],
    ]);
    const cycle = findCycleInGraph(parentOf);
    expect(cycle).not.toBeNull();
    expect(cycle).toEqual(expect.arrayContaining(["A", "B"]));
  });

  it("detects a deep indirect cycle (A->B->C->A)", () => {
    const parentOf = new Map<string, string | null>([
      ["A", "B"],
      ["B", "C"],
      ["C", "A"],
    ]);
    expect(findCycleInGraph(parentOf)).toEqual(expect.arrayContaining(["A", "B", "C"]));
  });

  it("detects self-reference (a node listed as its own parent)", () => {
    const parentOf = new Map<string, string | null>([["A", "A"]]);
    expect(findCycleInGraph(parentOf)).toEqual(["A"]);
  });

  it("is unaffected by iteration/insertion order — the same graph is cyclic regardless of which row came first in the file", () => {
    const forward = new Map<string, string | null>([
      ["A", "B"],
      ["B", "C"],
      ["C", "A"],
    ]);
    const shuffled = new Map<string, string | null>([
      ["C", "A"],
      ["A", "B"],
      ["B", "C"],
    ]);
    expect(findCycleInGraph(forward)).not.toBeNull();
    expect(findCycleInGraph(shuffled)).not.toBeNull();
  });

  it("finds a cycle that does not include every node in the graph (an otherwise-healthy tree plus one bad branch)", () => {
    const parentOf = new Map<string, string | null>([
      ["root", null],
      ["A", "root"],
      ["B", "root"],
      ["X", "Y"],
      ["Y", "X"],
    ]);
    expect(findCycleInGraph(parentOf)).toEqual(expect.arrayContaining(["X", "Y"]));
  });

  it("handles a legitimately deep acyclic chain without a false positive", () => {
    const depth = MAX_HIERARCHY_DEPTH + 50;
    const parentOf = new Map<string, string | null>();
    parentOf.set("n0", null);
    for (let i = 1; i <= depth; i++) parentOf.set(`n${i}`, `n${i - 1}`);
    expect(findCycleInGraph(parentOf)).toBeNull();
  });

  it("detects a cycle in a large ring without throwing — the depth guard never fires for real (even large) import-scale graphs", () => {
    const size = MAX_HIERARCHY_DEPTH * 3;
    const parentOf = new Map<string, string | null>();
    for (let i = 0; i < size; i++) {
      parentOf.set(`n${i}`, `n${(i + 1) % size}`); // one big ring — definitely cyclic
    }
    expect(findCycleInGraph(parentOf)).not.toBeNull();
  });
});
