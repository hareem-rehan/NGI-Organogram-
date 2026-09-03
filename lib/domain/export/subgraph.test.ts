import { describe, expect, it } from "vitest";

import type { OrganogramEdge, OrganogramNode } from "@/lib/domain/organogram";
import { buildExportSubgraph } from "./subgraph";
import type { ExportFilterState } from "./types";

function node(overrides: Partial<OrganogramNode> & { positionId: string }): OrganogramNode {
  return {
    positionCode: `POS-${overrides.positionId}`,
    title: `Title ${overrides.positionId}`,
    departmentId: "dept-eng",
    departmentName: "Engineering",
    departmentCode: "ENG",
    departmentColor: "#16a34a",
    jobGradeId: null,
    jobGradeName: null,
    organizationalLevel: 1,
    positionStatus: "ACTIVE",
    occupancyStatus: "vacant",
    occupantDisplayName: null,
    occupantEmployeeId: null,
    directReportCount: 0,
    primaryReportsToPositionId: null,
    hasChildren: false,
    isPlanned: false,
    isActive: true,
    ...overrides,
  };
}

const EMPTY_FILTERS: ExportFilterState = {
  departmentIds: [],
  levels: [],
  jobGradeIds: [],
  occupancy: "all",
  statuses: [],
};

// root -> vpEng -> engMgr, plus a planned position under engMgr. ROOT is
// deliberately in its own "dept-exec" department (not "dept-eng") so a
// Department Focus on Engineering genuinely exercises cross-department
// ancestor context, not an accidental same-department match.
const ROOT = node({
  positionId: "root",
  organizationalLevel: 1,
  departmentId: "dept-exec",
  departmentName: "Executive",
  departmentCode: "EXEC",
});
const VP_ENG = node({
  positionId: "vpEng",
  primaryReportsToPositionId: "root",
  organizationalLevel: 2,
});
const ENG_MGR = node({
  positionId: "engMgr",
  primaryReportsToPositionId: "vpEng",
  organizationalLevel: 3,
});
const PLANNED = node({
  positionId: "planned1",
  primaryReportsToPositionId: "engMgr",
  organizationalLevel: 4,
  positionStatus: "PLANNED",
  isPlanned: true,
});
const SALES_VP = node({
  positionId: "vpSales",
  departmentId: "dept-sales",
  departmentName: "Sales",
  departmentCode: "SALES",
  primaryReportsToPositionId: "root",
  organizationalLevel: 2,
});

const ALL_NODES: OrganogramNode[] = [ROOT, VP_ENG, ENG_MGR, PLANNED, SALES_VP];
const ALL_EDGES: OrganogramEdge[] = [
  { sourcePositionId: "root", targetPositionId: "vpEng", reportingType: "PRIMARY" },
  { sourcePositionId: "vpEng", targetPositionId: "engMgr", reportingType: "PRIMARY" },
  { sourcePositionId: "engMgr", targetPositionId: "planned1", reportingType: "PRIMARY" },
  { sourcePositionId: "root", targetPositionId: "vpSales", reportingType: "PRIMARY" },
];

describe("buildExportSubgraph", () => {
  it("FULL_COMPANY includes every position when includePlanned is true", () => {
    const result = buildExportSubgraph(ALL_NODES, ALL_EDGES, {
      scope: "FULL_COMPANY",
      selectedPositionId: null,
      selectedDepartmentId: null,
      descendantDepth: 2,
      includePlanned: true,
      filters: EMPTY_FILTERS,
    });
    expect(result.nodes.map((n) => n.positionId).sort()).toEqual(
      ["root", "vpEng", "engMgr", "planned1", "vpSales"].sort()
    );
    expect(result.edges).toHaveLength(4);
    expect(result.focusTargetMissing).toBe(false);
  });

  it("FULL_COMPANY excludes planned positions and their now-dangling edges when includePlanned is false", () => {
    const result = buildExportSubgraph(ALL_NODES, ALL_EDGES, {
      scope: "FULL_COMPANY",
      selectedPositionId: null,
      selectedDepartmentId: null,
      descendantDepth: 2,
      includePlanned: false,
      filters: EMPTY_FILTERS,
    });
    expect(result.nodes.map((n) => n.positionId)).not.toContain("planned1");
    expect(result.edges).toHaveLength(3);
    expect(result.edges.every((e) => e.targetPositionId !== "planned1")).toBe(true);
  });

  it("every FULL_COMPANY node has matchState 'none' — no match/context distinction applies", () => {
    const result = buildExportSubgraph(ALL_NODES, ALL_EDGES, {
      scope: "FULL_COMPANY",
      selectedPositionId: null,
      selectedDepartmentId: null,
      descendantDepth: 2,
      includePlanned: true,
      filters: EMPTY_FILTERS,
    });
    expect(result.nodes.every((n) => n.matchState === "none")).toBe(true);
  });

  it("CURRENT_VIEW with no active filter/focus behaves identically to FULL_COMPANY", () => {
    const result = buildExportSubgraph(ALL_NODES, ALL_EDGES, {
      scope: "CURRENT_VIEW",
      selectedPositionId: null,
      selectedDepartmentId: null,
      descendantDepth: 2,
      includePlanned: true,
      filters: EMPTY_FILTERS,
    });
    expect(result.nodes).toHaveLength(5);
  });

  it("CURRENT_VIEW with an active department filter includes the match plus its real ancestor as context, never a false edge", () => {
    const result = buildExportSubgraph(ALL_NODES, ALL_EDGES, {
      scope: "CURRENT_VIEW",
      selectedPositionId: null,
      selectedDepartmentId: null,
      descendantDepth: 2,
      includePlanned: true,
      filters: { ...EMPTY_FILTERS, departmentIds: ["dept-sales"] },
    });
    const ids = result.nodes.map((n) => n.positionId).sort();
    expect(ids).toEqual(["root", "vpSales"].sort());
    const vpSales = result.nodes.find((n) => n.positionId === "vpSales")!;
    const root = result.nodes.find((n) => n.positionId === "root")!;
    expect(vpSales.matchState).toBe("match");
    expect(root.matchState).toBe("context");
    // The real edge (root -> vpSales) is preserved; no edge connects two
    // non-adjacent positions.
    expect(result.edges).toEqual([
      { sourcePositionId: "root", targetPositionId: "vpSales", reportingType: "PRIMARY" },
    ]);
  });

  it("CURRENT_VIEW with a selectedPositionId behaves as Position Focus", () => {
    const result = buildExportSubgraph(ALL_NODES, ALL_EDGES, {
      scope: "CURRENT_VIEW",
      selectedPositionId: "vpEng",
      selectedDepartmentId: null,
      descendantDepth: 1,
      includePlanned: true,
      filters: EMPTY_FILTERS,
    });
    const ids = result.nodes.map((n) => n.positionId).sort();
    // vpEng (match) + root (ancestor context) + engMgr (1 descendant level).
    expect(ids).toEqual(["root", "vpEng", "engMgr"].sort());
  });

  it("POSITION_FOCUS scope resolves the ancestor chain as context and descendants normally", () => {
    const result = buildExportSubgraph(ALL_NODES, ALL_EDGES, {
      scope: "POSITION_FOCUS",
      selectedPositionId: "vpEng",
      selectedDepartmentId: null,
      descendantDepth: "all",
      includePlanned: true,
      filters: EMPTY_FILTERS,
    });
    const vpEng = result.nodes.find((n) => n.positionId === "vpEng")!;
    const root = result.nodes.find((n) => n.positionId === "root")!;
    const engMgr = result.nodes.find((n) => n.positionId === "engMgr")!;
    expect(vpEng.matchState).toBe("match");
    expect(root.matchState).toBe("context");
    expect(engMgr.matchState).toBe("none"); // a descendant, not context or match
  });

  it("POSITION_FOCUS on a nonexistent position returns an empty, safe result (focusTargetMissing)", () => {
    const result = buildExportSubgraph(ALL_NODES, ALL_EDGES, {
      scope: "POSITION_FOCUS",
      selectedPositionId: "does-not-exist",
      selectedDepartmentId: null,
      descendantDepth: 2,
      includePlanned: true,
      filters: EMPTY_FILTERS,
    });
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.focusTargetMissing).toBe(true);
  });

  it("DEPARTMENT_FOCUS scope includes department members plus cross-department ancestor context", () => {
    const result = buildExportSubgraph(ALL_NODES, ALL_EDGES, {
      scope: "DEPARTMENT_FOCUS",
      selectedPositionId: null,
      selectedDepartmentId: "dept-eng",
      descendantDepth: 2,
      includePlanned: true,
      filters: EMPTY_FILTERS,
    });
    const ids = result.nodes.map((n) => n.positionId).sort();
    expect(ids).toEqual(["root", "vpEng", "engMgr", "planned1"].sort());
    expect(result.nodes.find((n) => n.positionId === "root")!.matchState).toBe("context");
  });

  it("DEPARTMENT_FOCUS on a nonexistent department returns an empty, safe result", () => {
    const result = buildExportSubgraph(ALL_NODES, ALL_EDGES, {
      scope: "DEPARTMENT_FOCUS",
      selectedPositionId: null,
      selectedDepartmentId: "does-not-exist",
      descendantDepth: 2,
      includePlanned: true,
      filters: EMPTY_FILTERS,
    });
    expect(result.nodes).toEqual([]);
    expect(result.focusTargetMissing).toBe(true);
  });

  it("never produces an edge whose endpoint is absent from the returned node set", () => {
    const result = buildExportSubgraph(ALL_NODES, ALL_EDGES, {
      scope: "DEPARTMENT_FOCUS",
      selectedPositionId: null,
      selectedDepartmentId: "dept-sales",
      descendantDepth: 2,
      includePlanned: true,
      filters: EMPTY_FILTERS,
    });
    const nodeIds = new Set(result.nodes.map((n) => n.positionId));
    for (const edge of result.edges) {
      expect(nodeIds.has(edge.sourcePositionId)).toBe(true);
      expect(nodeIds.has(edge.targetPositionId)).toBe(true);
    }
  });
});
