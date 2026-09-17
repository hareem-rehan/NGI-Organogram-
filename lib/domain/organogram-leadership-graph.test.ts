import { describe, expect, it } from "vitest";

import type { OrganogramNode } from "./organogram";
import { projectLeadershipGraph } from "./organogram-leadership-graph";
import {
  departmentGroupId,
  DEFAULT_LEADERSHIP_VIEW_OPTIONS,
  type LeadershipViewOptions,
} from "./organogram-leadership";

const ENG = "dept-eng";
const HR = "dept-hr";
const EXEC = "dept-exec";

function node(overrides: Partial<OrganogramNode> & { positionId: string }): OrganogramNode {
  return {
    positionCode: `POS-${overrides.positionId}`,
    title: `Title ${overrides.positionId}`,
    departmentId: ENG,
    departmentName: "Engineering",
    departmentCode: "ENG",
    departmentColor: "#16a34a",
    jobGradeId: "grade",
    jobGradeName: "Leadership",
    jobGradeCode: "L9",
    jobGradeLevel: 9,
    organizationalLevel: 2,
    positionStatus: "ACTIVE",
    occupancyStatus: "occupied",
    occupantDisplayName: "Someone",
    occupantEmployeeId: "emp",
    directReportCount: 0,
    primaryReportsToPositionId: "ceo",
    hasChildren: false,
    isPlanned: false,
    isActive: true,
    ...overrides,
  };
}

function ceo(): OrganogramNode {
  return node({
    positionId: "ceo",
    title: "CEO",
    departmentId: EXEC,
    departmentName: "Executive",
    departmentCode: "EXEC",
    organizationalLevel: 1,
    primaryReportsToPositionId: null,
    jobGradeCode: "L18",
    jobGradeLevel: 18,
  });
}

function opts(overrides: Partial<LeadershipViewOptions> = {}): LeadershipViewOptions {
  return { ...DEFAULT_LEADERSHIP_VIEW_OPTIONS, ...overrides };
}

/** Drop below-threshold and unfilled roles entirely, instead of the default of keeping them. */
function hidingOpts(overrides: Partial<LeadershipViewOptions> = {}): LeadershipViewOptions {
  return opts({ belowThreshold: "hide", hideVacant: true, ...overrides });
}

function byId(result: { nodes: OrganogramNode[] }, id: string): OrganogramNode {
  const found = result.nodes.find((n) => n.positionId === id);
  if (!found) throw new Error(`expected node ${id} in the projected graph`);
  return found;
}

describe("projectLeadershipGraph — structure", () => {
  it("puts the department tier between the root and everyone else", () => {
    const nodes = [
      ceo(),
      node({ positionId: "cto", title: "CTO", departmentId: ENG, departmentName: "Engineering" }),
      node({
        positionId: "chro",
        title: "CHRO",
        departmentId: HR,
        departmentName: "People",
        departmentCode: "HR",
      }),
    ];

    const result = projectLeadershipGraph(nodes);

    expect(byId(result, "ceo").primaryReportsToPositionId).toBeNull();
    expect(byId(result, "ceo").displayDepth).toBe(1);

    const engGroup = byId(result, departmentGroupId(ENG));
    expect(engGroup.kind).toBe("department");
    expect(engGroup.title).toBe("Engineering");
    expect(engGroup.primaryReportsToPositionId).toBe("ceo");
    expect(engGroup.displayDepth).toBe(2);

    expect(byId(result, "cto").primaryReportsToPositionId).toBe(departmentGroupId(ENG));
    expect(byId(result, "cto").displayDepth).toBe(3);
    expect(byId(result, "chro").primaryReportsToPositionId).toBe(departmentGroupId(HR));
  });

  it("keeps a real manager when the manager is visible and in the same department", () => {
    const nodes = [
      ceo(),
      node({ positionId: "cto", departmentId: ENG }),
      node({ positionId: "vp", departmentId: ENG, primaryReportsToPositionId: "cto" }),
    ];

    const result = projectLeadershipGraph(nodes);

    expect(byId(result, "vp").primaryReportsToPositionId).toBe("cto");
    expect(byId(result, "cto").primaryReportsToPositionId).toBe(departmentGroupId(ENG));
    // CEO -> Engineering -> CTO -> VP
    expect(byId(result, "vp").displayDepth).toBe(4);
  });

  it("emits exactly one edge per non-root node and never a dangling one", () => {
    const nodes = [
      ceo(),
      node({ positionId: "cto", departmentId: ENG }),
      node({ positionId: "vp", departmentId: ENG, primaryReportsToPositionId: "cto" }),
      node({ positionId: "chro", departmentId: HR }),
    ];

    const result = projectLeadershipGraph(nodes);
    const ids = new Set(result.nodes.map((n) => n.positionId));

    expect(result.edges).toHaveLength(result.nodes.length - 1);
    for (const edge of result.edges) {
      expect(ids.has(edge.sourcePositionId)).toBe(true);
      expect(ids.has(edge.targetPositionId)).toBe(true);
    }
  });

  it("creates a department group only for departments that still have a visible member", () => {
    const nodes = [
      ceo(),
      node({ positionId: "cto", departmentId: ENG }),
      // Every member of HR is below the threshold, so "People" must not
      // appear as an empty heading.
      node({
        positionId: "hr-admin",
        departmentId: HR,
        departmentName: "People",
        jobGradeCode: "L4",
        jobGradeLevel: 4,
      }),
    ];

    const result = projectLeadershipGraph(nodes, hidingOpts());

    expect(result.nodes.some((n) => n.positionId === departmentGroupId(ENG))).toBe(true);
    expect(result.nodes.some((n) => n.positionId === departmentGroupId(HR))).toBe(false);
    expect(result.summary.departmentGroupCount).toBe(1);
  });
});

describe("projectLeadershipGraph — filtering", () => {
  it("hides positions below the grade threshold and counts them", () => {
    const nodes = [
      ceo(),
      node({ positionId: "cto", jobGradeLevel: 12 }),
      node({ positionId: "junior", jobGradeLevel: 4, jobGradeCode: "L4" }),
    ];

    const result = projectLeadershipGraph(nodes, hidingOpts());

    expect(result.nodes.some((n) => n.positionId === "junior")).toBe(false);
    expect(result.summary.hidden.belowGrade).toBe(1);
    expect(result.summary.hidden.total).toBe(1);
    expect(result.summary.shownPositionCount).toBe(2);
  });

  it("hides vacant positions and counts them separately from graded exclusions", () => {
    const nodes = [
      ceo(),
      node({ positionId: "cto" }),
      node({
        positionId: "empty-cfo",
        occupancyStatus: "vacant",
        occupantDisplayName: null,
        occupantEmployeeId: null,
      }),
    ];

    const result = projectLeadershipGraph(nodes, hidingOpts());

    expect(result.nodes.some((n) => n.positionId === "empty-cfo")).toBe(false);
    expect(result.summary.hidden).toEqual({
      vacant: 1,
      ungraded: 0,
      belowGrade: 0,
      inactive: 0,
      total: 1,
    });
  });

  it("re-parents a report whose own manager was filtered out, rather than dropping it", () => {
    const nodes = [
      ceo(),
      node({
        positionId: "vacant-vp",
        departmentId: ENG,
        occupancyStatus: "vacant",
        occupantDisplayName: null,
      }),
      node({ positionId: "director", departmentId: ENG, primaryReportsToPositionId: "vacant-vp" }),
    ];

    const result = projectLeadershipGraph(nodes, hidingOpts());

    expect(result.nodes.some((n) => n.positionId === "vacant-vp")).toBe(false);
    expect(byId(result, "director").primaryReportsToPositionId).toBe(departmentGroupId(ENG));
  });

  it("returns the unfiltered graph, with no department tier, when every switch is off", () => {
    const nodes = [
      ceo(),
      node({ positionId: "cto", departmentId: ENG }),
      node({ positionId: "junior", departmentId: ENG, jobGradeLevel: 3 }),
    ];

    const result = projectLeadershipGraph(
      nodes,
      opts({ hideVacant: false, hideUngraded: false, departmentFirst: false, minGradeLevel: 0 })
    );

    expect(result.nodes).toHaveLength(3);
    expect(result.nodes.every((n) => n.kind === "position")).toBe(true);
    expect(byId(result, "cto").primaryReportsToPositionId).toBe("ceo");
  });
});

describe("projectLeadershipGraph — node contract", () => {
  it("never claims an organizational level for a department heading", () => {
    // CLAUDE.md §2: department headings are not organizational levels.
    // Real levels are 1-based, so 0 is outside the scale by construction.
    const result = projectLeadershipGraph([ceo(), node({ positionId: "cto", departmentId: ENG })]);
    expect(byId(result, departmentGroupId(ENG)).organizationalLevel).toBe(0);
  });

  it("leaves every stored field of a surviving position untouched", () => {
    const cto = node({ positionId: "cto", departmentId: ENG, organizationalLevel: 2 });
    const result = projectLeadershipGraph([ceo(), cto]);
    const projected = byId(result, "cto");

    // Only the display-parent and the display-only additions may differ.
    expect(projected.organizationalLevel).toBe(cto.organizationalLevel);
    expect(projected.positionCode).toBe(cto.positionCode);
    expect(projected.jobGradeId).toBe(cto.jobGradeId);
    expect(projected.occupantEmployeeId).toBe(cto.occupantEmployeeId);
    expect(projected.directReportCount).toBe(cto.directReportCount);
  });

  it("reports the DISPLAYED child count separately from the real direct-report count", () => {
    // A manager with two reports, one of which the filter hides: the card
    // must not promise three boxes and then reveal one.
    const nodes = [
      ceo(),
      node({ positionId: "cto", departmentId: ENG, directReportCount: 2, hasChildren: true }),
      node({ positionId: "vp", departmentId: ENG, primaryReportsToPositionId: "cto" }),
      node({
        positionId: "intern",
        departmentId: ENG,
        primaryReportsToPositionId: "cto",
        jobGradeLevel: 2,
      }),
    ];

    const result = projectLeadershipGraph(nodes, hidingOpts());
    const cto = byId(result, "cto");

    expect(cto.directReportCount).toBe(2);
    expect(cto.displayChildCount).toBe(1);
    expect(cto.hasChildren).toBe(true);
  });

  it("marks a leaf as childless even when it had reports that are all now hidden", () => {
    const nodes = [
      ceo(),
      node({ positionId: "cto", departmentId: ENG, directReportCount: 1, hasChildren: true }),
      node({
        positionId: "intern",
        departmentId: ENG,
        primaryReportsToPositionId: "cto",
        jobGradeLevel: 2,
      }),
    ];

    const result = projectLeadershipGraph(nodes, hidingOpts());

    expect(byId(result, "cto").hasChildren).toBe(false);
    expect(byId(result, "cto").displayChildCount).toBe(0);
  });

  it("orders deterministically by display tier, then title, then code", () => {
    const nodes = [
      ceo(),
      node({ positionId: "b", title: "Zeta", departmentId: ENG }),
      node({ positionId: "a", title: "Alpha", departmentId: ENG }),
    ];

    const first = projectLeadershipGraph(nodes).nodes.map((n) => n.positionId);
    const second = projectLeadershipGraph([...nodes].reverse()).nodes.map((n) => n.positionId);

    expect(first).toEqual(second);
    expect(first[0]).toBe("ceo");
  });
});

describe("projectLeadershipGraph — degenerate input", () => {
  it("returns an empty graph for an empty company", () => {
    const result = projectLeadershipGraph([]);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.summary.shownPositionCount).toBe(0);
  });

  it("keeps the root even when the root itself would fail every filter", () => {
    const rootless = node({
      positionId: "ceo",
      primaryReportsToPositionId: null,
      occupancyStatus: "vacant",
      occupantDisplayName: null,
      jobGradeId: null,
      jobGradeCode: null,
      jobGradeLevel: null,
    });

    const result = projectLeadershipGraph([rootless]);

    expect(result.nodes.map((n) => n.positionId)).toEqual(["ceo"]);
    expect(result.summary.hidden.total).toBe(0);
  });
});

describe("projectLeadershipGraph — the default keeps junior roles in the graph", () => {
  it("draws a junior report under its manager and counts it as folded, not hidden", () => {
    const nodes = [
      ceo(),
      node({ positionId: "cto", departmentId: ENG }),
      node({
        positionId: "junior",
        departmentId: ENG,
        primaryReportsToPositionId: "cto",
        jobGradeCode: "L4",
        jobGradeLevel: 4,
      }),
    ];

    const result = projectLeadershipGraph(nodes);

    expect(byId(result, "junior").primaryReportsToPositionId).toBe("cto");
    expect(byId(result, "cto").hasChildren).toBe(true);
    expect(result.summary.collapsedBelowThreshold).toBe(1);
    expect(result.summary.hidden.total).toBe(0);
  });

  it("draws a role nobody holds", () => {
    const nodes = [
      ceo(),
      node({
        positionId: "unfilled",
        departmentId: ENG,
        occupancyStatus: "vacant",
        occupantDisplayName: null,
        occupantEmployeeId: null,
      }),
    ];

    const result = projectLeadershipGraph(nodes);

    expect(result.nodes.some((n) => n.positionId === "unfilled")).toBe(true);
    expect(result.summary.hidden.vacant).toBe(0);
  });
});

describe("projectLeadershipGraph — empty departments", () => {
  it("draws an empty active department as a childless heading node under the root", () => {
    const nodes = [ceo(), node({ positionId: "chro", departmentId: HR, departmentName: "People" })];
    const result = projectLeadershipGraph(nodes, DEFAULT_LEADERSHIP_VIEW_OPTIONS, [
      { id: HR, name: "People", code: "HR", color: null },
      { id: ENG, name: "Engineering", code: "ENG", color: null },
    ]);

    const engNode = result.nodes.find((n) => n.positionId === departmentGroupId(ENG));
    expect(engNode).toBeDefined();
    expect(engNode?.kind).toBe("department");
    expect(engNode?.title).toBe("Engineering");
    expect(engNode?.departmentCode).toBe("ENG");
    expect(engNode?.hasChildren).toBe(false);
    expect(engNode?.primaryReportsToPositionId).toBe("ceo");
    // No dangling edge: an empty department has an edge from the root but none below it.
    expect(result.edges.some((e) => e.targetPositionId === departmentGroupId(ENG))).toBe(true);
    expect(result.edges.some((e) => e.sourcePositionId === departmentGroupId(ENG))).toBe(false);
  });
});
