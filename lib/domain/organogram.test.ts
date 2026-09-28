import { describe, expect, it } from "vitest";

import {
  analyzeOrganogramSafety,
  buildOrganogramGraph,
  computeVisiblePositionIds,
  countHiddenDescendants,
  resolveDivisionColor,
  type OrganogramDepartmentInput,
  type OrganogramPositionInput,
} from "./organogram";

const DEPT: OrganogramDepartmentInput = {
  id: "dept-1",
  name: "Engineering",
  code: "ENG",
  color: "#16a34a",
};

function pos(
  overrides: Partial<OrganogramPositionInput> & { id: string }
): OrganogramPositionInput {
  return {
    positionCode: `POS-${overrides.id}`,
    title: `Title ${overrides.id}`,
    departmentId: DEPT.id,
    jobGradeId: null,
    jobFamilyId: null,
    organizationalLevel: 1,
    status: "ACTIVE",
    primaryReportsToPositionId: null,
    ...overrides,
  };
}

describe("resolveDivisionColor", () => {
  // The real shape: a single company root (Founder, no parent) with the
  // divisions directly beneath it, and sub-departments beneath those.
  const root: OrganogramDepartmentInput = {
    id: "root",
    name: "Founder",
    code: "FO",
    color: "#9b7fe0",
  };
  const division: OrganogramDepartmentInput = {
    id: "div",
    name: "Client Delivery Services",
    code: "CDS",
    color: "#3aa4e8",
    parentDepartmentId: "root",
  };
  const child: OrganogramDepartmentInput = {
    id: "child",
    name: "Product",
    code: "PROD",
    color: "#7c3aed",
    parentDepartmentId: "div",
  };
  const grandchild: OrganogramDepartmentInput = {
    id: "grandchild",
    name: "Product Design",
    code: "PROD-DES",
    color: "#e8811a",
    parentDepartmentId: "child",
  };
  const map = new Map([
    [root.id, root],
    [division.id, division],
    [child.id, child],
    [grandchild.id, grandchild],
  ]);

  it("returns the company root's own colour (it is its own division)", () => {
    expect(resolveDivisionColor("root", map)).toBe("#9b7fe0");
  });

  it("returns its own colour for a division directly under the root", () => {
    expect(resolveDivisionColor("div", map)).toBe("#3aa4e8");
  });

  it("returns the division's colour for a sub-department, not the root's", () => {
    expect(resolveDivisionColor("child", map)).toBe("#3aa4e8");
  });

  it("walks up to the division (below the root) from deeper levels", () => {
    expect(resolveDivisionColor("grandchild", map)).toBe("#3aa4e8");
  });

  it("falls back to the department's own colour when its parent is missing", () => {
    const orphan = new Map([
      [
        "orphan",
        { id: "orphan", name: "X", code: "X", color: "#111111", parentDepartmentId: "gone" },
      ],
    ]);
    expect(resolveDivisionColor("orphan", orphan)).toBe("#111111");
  });

  it("does not loop forever on a parent cycle", () => {
    const cyclic = new Map([
      ["a", { id: "a", name: "A", code: "A", color: "#aaaaaa", parentDepartmentId: "b" }],
      ["b", { id: "b", name: "B", code: "B", color: "#bbbbbb", parentDepartmentId: "a" }],
    ]);
    // Terminates and returns one of the two colours, never hangs.
    expect(["#aaaaaa", "#bbbbbb"]).toContain(resolveDivisionColor("a", cyclic));
  });

  it("returns null for an unknown department id", () => {
    expect(resolveDivisionColor("nope", map)).toBeNull();
  });
});

describe("analyzeOrganogramSafety", () => {
  it("marks a clean single-root tree fully safe", () => {
    const positions = [
      { id: "root", status: "ACTIVE" as const, primaryReportsToPositionId: null },
      { id: "child", status: "ACTIVE" as const, primaryReportsToPositionId: "root" },
    ];
    const result = analyzeOrganogramSafety(positions);
    expect(result.rootPositionId).toBe("root");
    expect(result.safePositionIds.size).toBe(2);
    expect(result.cyclePositionIds).toEqual([]);
    expect(result.disconnectedPositionIds).toEqual([]);
  });

  it("includes PLANNED and INACTIVE positions in the safety analysis, not just ACTIVE", () => {
    const positions = [
      { id: "root", status: "ACTIVE" as const, primaryReportsToPositionId: null },
      { id: "planned-child", status: "PLANNED" as const, primaryReportsToPositionId: "root" },
      { id: "inactive-child", status: "INACTIVE" as const, primaryReportsToPositionId: "root" },
    ];
    const result = analyzeOrganogramSafety(positions);
    expect(result.safePositionIds.has("planned-child")).toBe(true);
    expect(result.safePositionIds.has("inactive-child")).toBe(true);
  });

  it("isolates a cycle without infinite looping", () => {
    const positions = [
      { id: "a", status: "ACTIVE" as const, primaryReportsToPositionId: "b" },
      { id: "b", status: "ACTIVE" as const, primaryReportsToPositionId: "a" },
    ];
    const result = analyzeOrganogramSafety(positions);
    expect(result.cyclePositionIds.sort()).toEqual(["a", "b"]);
    expect(result.safePositionIds.size).toBe(0);
  });

  it("isolates a position with a dangling parent reference", () => {
    const positions = [
      { id: "root", status: "ACTIVE" as const, primaryReportsToPositionId: null },
      { id: "orphan", status: "ACTIVE" as const, primaryReportsToPositionId: "does-not-exist" },
    ];
    const result = analyzeOrganogramSafety(positions);
    expect(result.safePositionIds.has("root")).toBe(true);
    expect(result.disconnectedPositionIds).toEqual(["orphan"]);
  });

  it("returns a null root for zero positions", () => {
    expect(analyzeOrganogramSafety([]).rootPositionId).toBeNull();
  });
});

describe("buildOrganogramGraph", () => {
  it("builds one node per safe position with correct department/occupancy/job-grade fields", () => {
    const positions = [pos({ id: "root", organizationalLevel: 1 })];
    const { nodes } = buildOrganogramGraph({
      positions,
      safePositionIds: new Set(["root"]),
      departmentsById: new Map([[DEPT.id, DEPT]]),
      jobGradeNamesById: new Map(),
      occupantNamesByPositionId: new Map([["root", "Amara Chen"]]),
      occupantEmployeeIdsByPositionId: new Map([["root", "employee-1"]]),
    });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      positionId: "root",
      departmentName: "Engineering",
      departmentColor: "#16a34a",
      occupancyStatus: "occupied",
      occupantDisplayName: "Amara Chen",
      occupantEmployeeId: "employee-1",
      isActive: true,
      isPlanned: false,
    });
  });

  it("paints a sub-department's node with its division's colour, not the company root's", () => {
    // Founder (root) → Client Delivery Services (division) → Product (sub).
    const rootDept: OrganogramDepartmentInput = {
      id: "founder",
      name: "Founder",
      code: "FO",
      color: "#9b7fe0",
    };
    const divisionDept: OrganogramDepartmentInput = {
      id: "cds",
      name: "Client Delivery Services",
      code: "CDS",
      color: "#3aa4e8",
      parentDepartmentId: "founder",
    };
    const childDept: OrganogramDepartmentInput = {
      id: "product",
      name: "Product",
      code: "PROD",
      color: "#7c3aed",
      parentDepartmentId: "cds",
    };
    const positions = [pos({ id: "p1", departmentId: "product" })];
    const { nodes } = buildOrganogramGraph({
      positions,
      safePositionIds: new Set(["p1"]),
      departmentsById: new Map([
        [rootDept.id, rootDept],
        [divisionDept.id, divisionDept],
        [childDept.id, childDept],
      ]),
      jobGradeNamesById: new Map(),
      occupantNamesByPositionId: new Map(),
      occupantEmployeeIdsByPositionId: new Map(),
    });
    // Keeps its own department identity, but takes its division's colour —
    // the division below the root, never the root's own colour.
    expect(nodes[0]).toMatchObject({
      departmentName: "Product",
      departmentColor: "#3aa4e8",
    });
  });

  it("leaves occupantEmployeeId null when the position is vacant", () => {
    const positions = [pos({ id: "root" })];
    const { nodes } = buildOrganogramGraph({
      positions,
      safePositionIds: new Set(["root"]),
      departmentsById: new Map([[DEPT.id, DEPT]]),
      jobGradeNamesById: new Map(),
      occupantNamesByPositionId: new Map(),
      occupantEmployeeIdsByPositionId: new Map(),
    });
    expect(nodes[0]?.occupantEmployeeId).toBeNull();
  });

  it("marks a position with no current occupant as vacant, occupantDisplayName null", () => {
    const positions = [pos({ id: "root" })];
    const { nodes } = buildOrganogramGraph({
      positions,
      safePositionIds: new Set(["root"]),
      departmentsById: new Map([[DEPT.id, DEPT]]),
      jobGradeNamesById: new Map(),
      occupantNamesByPositionId: new Map(),
      occupantEmployeeIdsByPositionId: new Map(),
    });
    expect(nodes[0]?.occupancyStatus).toBe("vacant");
    expect(nodes[0]?.occupantDisplayName).toBeNull();
  });

  it("excludes unsafe positions entirely — never renders a corrupted node", () => {
    const positions = [
      pos({ id: "root" }),
      pos({ id: "cyclic", primaryReportsToPositionId: "cyclic" }),
    ];
    const { nodes } = buildOrganogramGraph({
      positions,
      safePositionIds: new Set(["root"]), // "cyclic" deliberately excluded
      departmentsById: new Map([[DEPT.id, DEPT]]),
      jobGradeNamesById: new Map(),
      occupantNamesByPositionId: new Map(),
      occupantEmployeeIdsByPositionId: new Map(),
    });
    expect(nodes.map((n) => n.positionId)).toEqual(["root"]);
  });

  it("never creates a dangling edge — a child's parent pointer is null if the parent was excluded", () => {
    const positions = [
      pos({ id: "root" }),
      pos({ id: "child", primaryReportsToPositionId: "excluded-parent", organizationalLevel: 2 }),
    ];
    const { nodes, edges } = buildOrganogramGraph({
      positions,
      safePositionIds: new Set(["root", "child"]), // "excluded-parent" not in the positions array at all
      departmentsById: new Map([[DEPT.id, DEPT]]),
      jobGradeNamesById: new Map(),
      occupantNamesByPositionId: new Map(),
      occupantEmployeeIdsByPositionId: new Map(),
    });
    const child = nodes.find((n) => n.positionId === "child");
    expect(child?.primaryReportsToPositionId).toBeNull();
    expect(edges.some((e) => e.targetPositionId === "child")).toBe(false);
  });

  it("computes directReportCount and hasChildren from safe children only", () => {
    const positions = [
      pos({ id: "root" }),
      pos({ id: "child-a", primaryReportsToPositionId: "root", organizationalLevel: 2 }),
      pos({ id: "child-b", primaryReportsToPositionId: "root", organizationalLevel: 2 }),
    ];
    const { nodes } = buildOrganogramGraph({
      positions,
      safePositionIds: new Set(["root", "child-a", "child-b"]),
      departmentsById: new Map([[DEPT.id, DEPT]]),
      jobGradeNamesById: new Map(),
      occupantNamesByPositionId: new Map(),
      occupantEmployeeIdsByPositionId: new Map(),
    });
    const root = nodes.find((n) => n.positionId === "root")!;
    expect(root.directReportCount).toBe(2);
    expect(root.hasChildren).toBe(true);
    const leaf = nodes.find((n) => n.positionId === "child-a")!;
    expect(leaf.directReportCount).toBe(0);
    expect(leaf.hasChildren).toBe(false);
  });

  it("produces exactly one PRIMARY edge per non-root safe position, matching parent/child", () => {
    const positions = [
      pos({ id: "root" }),
      pos({ id: "child", primaryReportsToPositionId: "root", organizationalLevel: 2 }),
    ];
    const { edges } = buildOrganogramGraph({
      positions,
      safePositionIds: new Set(["root", "child"]),
      departmentsById: new Map([[DEPT.id, DEPT]]),
      jobGradeNamesById: new Map(),
      occupantNamesByPositionId: new Map(),
      occupantEmployeeIdsByPositionId: new Map(),
    });
    expect(edges).toEqual([
      { sourcePositionId: "root", targetPositionId: "child", reportingType: "PRIMARY" },
    ]);
  });

  it("falls back to a safe placeholder department name when the department is missing", () => {
    const positions = [pos({ id: "root", departmentId: "missing-dept" })];
    const { nodes } = buildOrganogramGraph({
      positions,
      safePositionIds: new Set(["root"]),
      departmentsById: new Map(),
      jobGradeNamesById: new Map(),
      occupantNamesByPositionId: new Map(),
      occupantEmployeeIdsByPositionId: new Map(),
    });
    expect(nodes[0]?.departmentName).toBe("Unknown Department");
  });

  it("returns nodes in deterministic order — level, then title, then position code", () => {
    const positions = [
      pos({ id: "b", title: "Beta", organizationalLevel: 1 }),
      pos({ id: "a", title: "Alpha", organizationalLevel: 1 }),
      pos({ id: "c", title: "Gamma", organizationalLevel: 2, primaryReportsToPositionId: "a" }),
    ];
    const { nodes } = buildOrganogramGraph({
      positions,
      safePositionIds: new Set(["a", "b", "c"]),
      departmentsById: new Map([[DEPT.id, DEPT]]),
      jobGradeNamesById: new Map(),
      occupantNamesByPositionId: new Map(),
      occupantEmployeeIdsByPositionId: new Map(),
    });
    expect(nodes.map((n) => n.positionId)).toEqual(["a", "b", "c"]);
  });

  it("breaks a same-level, same-title tie by position code", () => {
    const positions = [
      pos({ id: "z", title: "Same Title", positionCode: "POS-Z", organizationalLevel: 1 }),
      pos({ id: "y", title: "Same Title", positionCode: "POS-Y", organizationalLevel: 1 }),
    ];
    const { nodes } = buildOrganogramGraph({
      positions,
      safePositionIds: new Set(["y", "z"]),
      departmentsById: new Map([[DEPT.id, DEPT]]),
      jobGradeNamesById: new Map(),
      occupantNamesByPositionId: new Map(),
      occupantEmployeeIdsByPositionId: new Map(),
    });
    expect(nodes.map((n) => n.positionId)).toEqual(["y", "z"]);
  });

  it("produces identical output for the same input across repeated calls (deterministic, no hidden randomness)", () => {
    const positions = [
      pos({ id: "root" }),
      pos({ id: "child", primaryReportsToPositionId: "root", organizationalLevel: 2 }),
    ];
    const args = {
      positions,
      safePositionIds: new Set(["root", "child"]),
      departmentsById: new Map([[DEPT.id, DEPT]]),
      jobGradeNamesById: new Map(),
      occupantNamesByPositionId: new Map(),
      occupantEmployeeIdsByPositionId: new Map(),
    };
    const first = buildOrganogramGraph(args);
    const second = buildOrganogramGraph(args);
    expect(first).toEqual(second);
  });

  it("includes a job grade name when present, null when absent", () => {
    const positions = [pos({ id: "root", jobGradeId: "grade-1" }), pos({ id: "no-grade" })];
    const { nodes } = buildOrganogramGraph({
      positions,
      safePositionIds: new Set(["root", "no-grade"]),
      departmentsById: new Map([[DEPT.id, DEPT]]),
      jobGradeNamesById: new Map([["grade-1", "Manager"]]),
      occupantNamesByPositionId: new Map(),
      occupantEmployeeIdsByPositionId: new Map(),
    });
    expect(nodes.find((n) => n.positionId === "root")?.jobGradeName).toBe("Manager");
    expect(nodes.find((n) => n.positionId === "no-grade")?.jobGradeName).toBeNull();
  });
});

describe("computeVisiblePositionIds", () => {
  const chain = [
    { positionId: "root", primaryReportsToPositionId: null, isPlanned: false },
    { positionId: "child", primaryReportsToPositionId: "root", isPlanned: false },
    { positionId: "grandchild", primaryReportsToPositionId: "child", isPlanned: false },
  ];

  it("shows everything when nothing is collapsed", () => {
    const visible = computeVisiblePositionIds({
      allNodes: chain,
      collapsedIds: new Set(),
      showPlanned: true,
    });
    expect(visible).toEqual(new Set(["root", "child", "grandchild"]));
  });

  it("hides all descendants of a collapsed node, but keeps the collapsed node itself visible", () => {
    const visible = computeVisiblePositionIds({
      allNodes: chain,
      collapsedIds: new Set(["child"]),
      showPlanned: true,
    });
    expect(visible).toEqual(new Set(["root", "child"]));
  });

  it("hides a planned node (and its subtree) when showPlanned is false", () => {
    const nodes = [
      { positionId: "root", primaryReportsToPositionId: null, isPlanned: false },
      { positionId: "planned", primaryReportsToPositionId: "root", isPlanned: true },
      { positionId: "planned-child", primaryReportsToPositionId: "planned", isPlanned: false },
    ];
    const visible = computeVisiblePositionIds({
      allNodes: nodes,
      collapsedIds: new Set(),
      showPlanned: false,
    });
    expect(visible).toEqual(new Set(["root"]));
  });

  it("shows a planned node when showPlanned is true (default)", () => {
    const nodes = [
      { positionId: "root", primaryReportsToPositionId: null, isPlanned: false },
      { positionId: "planned", primaryReportsToPositionId: "root", isPlanned: true },
    ];
    const visible = computeVisiblePositionIds({
      allNodes: nodes,
      collapsedIds: new Set(),
      showPlanned: true,
    });
    expect(visible).toEqual(new Set(["root", "planned"]));
  });

  it("is idempotent — repeated calls with the same state never grow or duplicate the visible set", () => {
    const first = computeVisiblePositionIds({
      allNodes: chain,
      collapsedIds: new Set(),
      showPlanned: true,
    });
    const second = computeVisiblePositionIds({
      allNodes: chain,
      collapsedIds: new Set(),
      showPlanned: true,
    });
    expect([...first].sort()).toEqual([...second].sort());
  });

  it("handles zero nodes without error", () => {
    expect(
      computeVisiblePositionIds({ allNodes: [], collapsedIds: new Set(), showPlanned: true }).size
    ).toBe(0);
  });

  it("supports nested collapse — collapsing a grandparent hides both child and grandchild", () => {
    const visible = computeVisiblePositionIds({
      allNodes: chain,
      collapsedIds: new Set(["root"]),
      showPlanned: true,
    });
    expect(visible).toEqual(new Set(["root"]));
  });

  it("Phase 9: restrictToIds confines traversal to a search/filter/focus subtree", () => {
    const visible = computeVisiblePositionIds({
      allNodes: chain,
      collapsedIds: new Set(),
      showPlanned: true,
      restrictToIds: new Set(["root", "child"]), // grandchild excluded
    });
    expect(visible).toEqual(new Set(["root", "child"]));
  });

  it("Phase 9: restrictToIds composes with collapse — a node must satisfy both", () => {
    const visible = computeVisiblePositionIds({
      allNodes: chain,
      collapsedIds: new Set(["child"]), // would already hide grandchild
      showPlanned: true,
      restrictToIds: new Set(["root", "child", "grandchild"]), // permits it structurally
    });
    expect(visible).toEqual(new Set(["root", "child"]));
  });

  it("Phase 9: omitting restrictToIds behaves exactly as Phase 8 (backward compatible)", () => {
    const visible = computeVisiblePositionIds({
      allNodes: chain,
      collapsedIds: new Set(),
      showPlanned: true,
    });
    expect(visible).toEqual(new Set(["root", "child", "grandchild"]));
  });
});

describe("countHiddenDescendants", () => {
  it("counts all descendants, not just direct children", () => {
    const nodes = [
      { positionId: "root", primaryReportsToPositionId: null, isPlanned: false },
      { positionId: "child", primaryReportsToPositionId: "root", isPlanned: false },
      { positionId: "grandchild", primaryReportsToPositionId: "child", isPlanned: false },
    ];
    expect(countHiddenDescendants("root", nodes)).toBe(2);
  });

  it("returns 0 for a leaf node", () => {
    const nodes = [{ positionId: "root", primaryReportsToPositionId: null, isPlanned: false }];
    expect(countHiddenDescendants("root", nodes)).toBe(0);
  });
});

describe("co-heads (docs/DECISIONS.md D27)", () => {
  // root → A → A1, root → B; T reports to B (head 1) and A1 (head 2).
  const positions = [
    pos({ id: "root" }),
    pos({ id: "A", primaryReportsToPositionId: "root", organizationalLevel: 2 }),
    pos({ id: "A1", primaryReportsToPositionId: "A", organizationalLevel: 3 }),
    pos({ id: "B", primaryReportsToPositionId: "root", organizationalLevel: 2 }),
    pos({
      id: "T",
      primaryReportsToPositionId: "B",
      coReportsToPositionId: "A1",
      organizationalLevel: 4,
    }),
  ];
  const allSafe = new Set(positions.map((p) => p.id));

  function graph(safe: ReadonlySet<string> = allSafe) {
    return buildOrganogramGraph({
      positions,
      safePositionIds: safe,
      departmentsById: new Map([[DEPT.id, DEPT]]),
      jobGradeNamesById: new Map(),
      occupantNamesByPositionId: new Map(),
      occupantEmployeeIdsByPositionId: new Map(),
    });
  }

  it("emits one edge per head — a PRIMARY and a CO edge into the shared position", () => {
    const { edges } = graph();
    const intoT = edges.filter((e) => e.targetPositionId === "T");
    expect(intoT).toEqual(
      expect.arrayContaining([
        { sourcePositionId: "B", targetPositionId: "T", reportingType: "PRIMARY" },
        { sourcePositionId: "A1", targetPositionId: "T", reportingType: "CO" },
      ])
    );
    expect(intoT).toHaveLength(2);
  });

  it("counts the shared position as a direct report of BOTH heads", () => {
    const { nodes } = graph();
    const find = (id: string) => nodes.find((n) => n.positionId === id)!;
    expect(find("B").directReportCount).toBe(1);
    expect(find("A1").directReportCount).toBe(1);
    expect(find("A1").hasChildren).toBe(true);
    expect(find("T").coReportsToPositionId).toBe("A1");
  });

  it("drops the second-head link (never a dangling edge) when that head is not rendered", () => {
    const { nodes, edges } = graph(new Set(["root", "B", "T"]));
    expect(nodes.find((n) => n.positionId === "T")!.coReportsToPositionId).toBeNull();
    expect(edges.some((e) => e.reportingType === "CO")).toBe(false);
  });

  it("keeps the shared position visible while EITHER head is expanded", () => {
    const { nodes } = graph();
    const visibleWithBCollapsed = computeVisiblePositionIds({
      allNodes: nodes,
      collapsedIds: new Set(["B"]),
      showPlanned: true,
    });
    expect(visibleWithBCollapsed.has("T")).toBe(true); // still shown under A1

    const visibleWithBothCollapsed = computeVisiblePositionIds({
      allNodes: nodes,
      collapsedIds: new Set(["B", "A1"]),
      showPlanned: true,
    });
    expect(visibleWithBothCollapsed.has("T")).toBe(false);
  });

  it("counts a descendant reached through two heads once when collapsed", () => {
    const { nodes } = graph();
    // Under root: A, A1, B, T — T is reachable through both B and A1.
    expect(countHiddenDescendants("root", nodes)).toBe(4);
  });
});
