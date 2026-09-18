import { describe, expect, it } from "vitest";

import {
  buildChildrenByParent,
  buildDepartmentFocusVisibleSet,
  buildFilteredVisibleSet,
  buildPositionFocusVisibleSet,
  computeAncestorChain,
  computeDescendantIds,
  type FocusNodeInput,
} from "./organogram-focus";

// root -> child -> grandchild -> great-grandchild, plus a sibling of
// child (vpSales) and a cross-department manager scenario.
const CHAIN: FocusNodeInput[] = [
  { positionId: "root", primaryReportsToPositionId: null, departmentId: "dept-exec" },
  { positionId: "vp-eng", primaryReportsToPositionId: "root", departmentId: "dept-eng" },
  { positionId: "vp-sales", primaryReportsToPositionId: "root", departmentId: "dept-sales" },
  { positionId: "eng-manager", primaryReportsToPositionId: "vp-eng", departmentId: "dept-eng" },
  { positionId: "engineer", primaryReportsToPositionId: "eng-manager", departmentId: "dept-eng" },
  // A sales rep reports to the (cross-department) VP Engineering — a
  // deliberately unusual but structurally valid real-world shape, used
  // to exercise "cross-department manager as context."
  { positionId: "sales-rep", primaryReportsToPositionId: "vp-eng", departmentId: "dept-sales" },
];

describe("computeAncestorChain", () => {
  it("includes the starting position itself, walking up to the root", () => {
    expect(computeAncestorChain("engineer", new Map(CHAIN.map((n) => [n.positionId, n])))).toEqual([
      "engineer",
      "eng-manager",
      "vp-eng",
      "root",
    ]);
  });

  it("returns just the root for a root-level position", () => {
    expect(computeAncestorChain("root", new Map(CHAIN.map((n) => [n.positionId, n])))).toEqual([
      "root",
    ]);
  });

  it("returns an empty array for a position id that doesn't exist (safe state, not an error)", () => {
    expect(computeAncestorChain("missing", new Map(CHAIN.map((n) => [n.positionId, n])))).toEqual(
      []
    );
  });
});

describe("computeDescendantIds", () => {
  const childrenByParent = buildChildrenByParent(CHAIN);

  it("depth 1 returns only direct reports", () => {
    expect(computeDescendantIds("vp-eng", childrenByParent, 1)).toEqual(
      new Set(["eng-manager", "sales-rep"])
    );
  });

  it("depth 2 returns two levels", () => {
    expect(computeDescendantIds("vp-eng", childrenByParent, 2)).toEqual(
      new Set(["eng-manager", "sales-rep", "engineer"])
    );
  });

  it('depth "all" returns every descendant regardless of depth', () => {
    expect(computeDescendantIds("root", childrenByParent, "all")).toEqual(
      new Set(["vp-eng", "vp-sales", "eng-manager", "sales-rep", "engineer"])
    );
  });

  it("returns an empty set for a leaf position", () => {
    expect(computeDescendantIds("engineer", childrenByParent, "all")).toEqual(new Set());
  });

  it("returns an empty set for a position with no children at all when depth 1 is requested", () => {
    expect(computeDescendantIds("vp-sales", childrenByParent, 1)).toEqual(new Set());
  });
});

describe("buildFilteredVisibleSet — structural-context strategy", () => {
  const byIdNodes = CHAIN;

  it("one match includes all of its real ancestors as context", () => {
    const result = buildFilteredVisibleSet(byIdNodes, new Set(["engineer"]));
    expect(result.matchIds).toEqual(new Set(["engineer"]));
    expect(result.contextIds).toEqual(new Set(["eng-manager", "vp-eng", "root"]));
    expect(result.visibleIds).toEqual(new Set(["engineer", "eng-manager", "vp-eng", "root"]));
  });

  it("a matched descendant never connects directly to root — every intermediary stays present as context", () => {
    const result = buildFilteredVisibleSet(byIdNodes, new Set(["engineer"]));
    // The chain root -> vp-eng -> eng-manager -> engineer is fully intact.
    expect(result.visibleIds.has("vp-eng")).toBe(true);
    expect(result.visibleIds.has("eng-manager")).toBe(true);
  });

  it("multiple matches in one branch share common ancestors without duplication", () => {
    const result = buildFilteredVisibleSet(byIdNodes, new Set(["engineer", "eng-manager"]));
    expect(result.matchIds).toEqual(new Set(["engineer", "eng-manager"]));
    // eng-manager is itself a match, so it must NOT also appear as context.
    expect(result.contextIds).toEqual(new Set(["vp-eng", "root"]));
    expect(result.visibleIds).toEqual(new Set(["engineer", "eng-manager", "vp-eng", "root"]));
  });

  it("matches across departments share the common root as context", () => {
    const result = buildFilteredVisibleSet(byIdNodes, new Set(["engineer", "vp-sales"]));
    expect(result.contextIds).toEqual(new Set(["eng-manager", "vp-eng", "root"]));
    expect(result.matchIds.has("vp-sales")).toBe(true);
  });

  it("a root match needs no context at all", () => {
    const result = buildFilteredVisibleSet(byIdNodes, new Set(["root"]));
    expect(result.contextIds).toEqual(new Set());
    expect(result.visibleIds).toEqual(new Set(["root"]));
  });

  it("no matches produces an entirely empty result (a safe, explicit empty state, not a crash)", () => {
    const result = buildFilteredVisibleSet(byIdNodes, new Set());
    expect(result.matchIds).toEqual(new Set());
    expect(result.contextIds).toEqual(new Set());
    expect(result.visibleIds).toEqual(new Set());
  });

  it("context nodes are never counted as matches", () => {
    const result = buildFilteredVisibleSet(byIdNodes, new Set(["engineer"]));
    for (const id of result.contextIds) {
      expect(result.matchIds.has(id)).toBe(false);
    }
  });

  it("cross-department manager positions appear as context, never re-attributed", () => {
    // sales-rep (dept-sales) reports to vp-eng (dept-eng) — a real,
    // structurally valid cross-department reporting line.
    const result = buildFilteredVisibleSet(byIdNodes, new Set(["sales-rep"]));
    expect(result.contextIds).toEqual(new Set(["vp-eng", "root"]));
  });
});

describe("buildPositionFocusVisibleSet", () => {
  it("root focus with all descendants shows the entire company, no context needed", () => {
    const result = buildPositionFocusVisibleSet(CHAIN, "root", "all");
    expect(result.matchIds).toEqual(new Set(["root"]));
    expect(result.contextIds).toEqual(new Set());
    expect(result.visibleIds.size).toBe(CHAIN.length);
  });

  it("one descendant level (Direct Reports Only)", () => {
    const result = buildPositionFocusVisibleSet(CHAIN, "vp-eng", 1);
    expect(result.visibleIds).toEqual(new Set(["vp-eng", "root", "eng-manager", "sales-rep"]));
  });

  it("two descendant levels", () => {
    const result = buildPositionFocusVisibleSet(CHAIN, "vp-eng", 2);
    expect(result.visibleIds).toEqual(
      new Set(["vp-eng", "root", "eng-manager", "sales-rep", "engineer"])
    );
  });

  it("a leaf position has no descendants but still shows its full ancestor path", () => {
    const result = buildPositionFocusVisibleSet(CHAIN, "engineer", "all");
    expect(result.matchIds).toEqual(new Set(["engineer"]));
    expect(result.contextIds).toEqual(new Set(["eng-manager", "vp-eng", "root"]));
  });

  it("a missing/inaccessible position returns an entirely empty, safe result", () => {
    const result = buildPositionFocusVisibleSet(CHAIN, "cross-company-id", "all");
    expect(result.matchIds).toEqual(new Set());
    expect(result.contextIds).toEqual(new Set());
    expect(result.visibleIds).toEqual(new Set());
  });

  it("ancestor context is never re-labeled as a descendant match", () => {
    const result = buildPositionFocusVisibleSet(CHAIN, "eng-manager", 1);
    expect(result.contextIds).toEqual(new Set(["vp-eng", "root"]));
    expect(result.matchIds).toEqual(new Set(["eng-manager"]));
  });
});

describe("buildDepartmentFocusVisibleSet", () => {
  it("includes only positions in the department as matches", () => {
    const result = buildDepartmentFocusVisibleSet(CHAIN, "dept-eng");
    expect(result.matchIds).toEqual(new Set(["vp-eng", "eng-manager", "engineer"]));
  });

  it("pulls in the cross-department root as context, never as a match", () => {
    const result = buildDepartmentFocusVisibleSet(CHAIN, "dept-eng");
    expect(result.contextIds).toEqual(new Set(["root"]));
  });

  it("a sales-department focus correctly shows the cross-department manager (vp-eng) as context, not as a sales match", () => {
    const result = buildDepartmentFocusVisibleSet(CHAIN, "dept-sales");
    expect(result.matchIds).toEqual(new Set(["vp-sales", "sales-rep"]));
    expect(result.contextIds).toEqual(new Set(["root", "vp-eng"]));
    expect(result.matchIds.has("vp-eng")).toBe(false);
  });

  it("an empty department (no positions) returns an entirely empty result, not an error", () => {
    const result = buildDepartmentFocusVisibleSet(CHAIN, "dept-empty");
    expect(result.matchIds).toEqual(new Set());
    expect(result.visibleIds).toEqual(new Set());
  });

  it("a nonexistent/cross-company department id behaves identically to an empty department", () => {
    const result = buildDepartmentFocusVisibleSet(CHAIN, "cross-company-dept");
    expect(result.matchIds).toEqual(new Set());
  });
});
