import { describe, expect, it } from "vitest";

import {
  computeFilterMatchIds,
  emptyFilterState,
  isAnyFilterActive,
  nodeMatchesFilters,
  type OrganogramFilterState,
} from "./organogram-filters";
import type { OrganogramNode } from "./organogram";

function node(overrides: Partial<OrganogramNode> & { positionId: string }): OrganogramNode {
  return {
    positionCode: `POS-${overrides.positionId}`,
    title: `Title ${overrides.positionId}`,
    departmentId: "dept-1",
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

describe("isAnyFilterActive", () => {
  it("is false for the empty filter state", () => {
    expect(isAnyFilterActive(emptyFilterState())).toBe(false);
  });

  it("is true when any single field is set", () => {
    expect(isAnyFilterActive({ ...emptyFilterState(), departmentIds: new Set(["d1"]) })).toBe(true);
    expect(isAnyFilterActive({ ...emptyFilterState(), occupancy: "vacant" })).toBe(true);
  });
});

describe("nodeMatchesFilters", () => {
  it("matches everything when no filter is active", () => {
    expect(nodeMatchesFilters(node({ positionId: "a" }), emptyFilterState())).toBe(true);
  });

  it("filters by one department", () => {
    const filters: OrganogramFilterState = {
      ...emptyFilterState(),
      departmentIds: new Set(["dept-1"]),
    };
    expect(nodeMatchesFilters(node({ positionId: "a", departmentId: "dept-1" }), filters)).toBe(
      true
    );
    expect(nodeMatchesFilters(node({ positionId: "b", departmentId: "dept-2" }), filters)).toBe(
      false
    );
  });

  it("filters by multiple departments (OR within the field)", () => {
    const filters: OrganogramFilterState = {
      ...emptyFilterState(),
      departmentIds: new Set(["dept-1", "dept-2"]),
    };
    expect(nodeMatchesFilters(node({ positionId: "a", departmentId: "dept-2" }), filters)).toBe(
      true
    );
    expect(nodeMatchesFilters(node({ positionId: "b", departmentId: "dept-3" }), filters)).toBe(
      false
    );
  });

  it("filters by organizational level, never by job grade", () => {
    const filters: OrganogramFilterState = { ...emptyFilterState(), levels: new Set([2]) };
    expect(nodeMatchesFilters(node({ positionId: "a", organizationalLevel: 2 }), filters)).toBe(
      true
    );
    expect(nodeMatchesFilters(node({ positionId: "b", organizationalLevel: 3 }), filters)).toBe(
      false
    );
  });

  it("filters by job grade", () => {
    const filters: OrganogramFilterState = { ...emptyFilterState(), jobGradeIds: new Set(["g1"]) };
    expect(nodeMatchesFilters(node({ positionId: "a", jobGradeId: "g1" }), filters)).toBe(true);
    expect(nodeMatchesFilters(node({ positionId: "b", jobGradeId: "g2" }), filters)).toBe(false);
  });

  it('supports "Not Assigned" job grade via a null sentinel in the set', () => {
    const filters: OrganogramFilterState = {
      ...emptyFilterState(),
      jobGradeIds: new Set([null]),
    };
    expect(nodeMatchesFilters(node({ positionId: "a", jobGradeId: null }), filters)).toBe(true);
    expect(nodeMatchesFilters(node({ positionId: "b", jobGradeId: "g1" }), filters)).toBe(false);
  });

  it("filters by occupancy — occupied", () => {
    const filters: OrganogramFilterState = { ...emptyFilterState(), occupancy: "occupied" };
    expect(
      nodeMatchesFilters(node({ positionId: "a", occupancyStatus: "occupied" }), filters)
    ).toBe(true);
    expect(nodeMatchesFilters(node({ positionId: "b", occupancyStatus: "vacant" }), filters)).toBe(
      false
    );
  });

  it("filters by occupancy — vacant", () => {
    const filters: OrganogramFilterState = { ...emptyFilterState(), occupancy: "vacant" };
    expect(nodeMatchesFilters(node({ positionId: "a", occupancyStatus: "vacant" }), filters)).toBe(
      true
    );
    expect(
      nodeMatchesFilters(node({ positionId: "b", occupancyStatus: "occupied" }), filters)
    ).toBe(false);
  });

  it('"all" occupancy never excludes a node', () => {
    const filters: OrganogramFilterState = { ...emptyFilterState(), occupancy: "all" };
    expect(nodeMatchesFilters(node({ positionId: "a", occupancyStatus: "vacant" }), filters)).toBe(
      true
    );
  });

  it("filters by position status, kept fully independent of occupancy", () => {
    const filters: OrganogramFilterState = {
      ...emptyFilterState(),
      statuses: new Set(["PLANNED" as const]),
    };
    expect(
      nodeMatchesFilters(
        node({ positionId: "a", positionStatus: "PLANNED", occupancyStatus: "vacant" }),
        filters
      )
    ).toBe(true);
    expect(nodeMatchesFilters(node({ positionId: "b", positionStatus: "ACTIVE" }), filters)).toBe(
      false
    );
  });

  it("combined filters narrow the result — a node must satisfy every active field", () => {
    const filters: OrganogramFilterState = {
      ...emptyFilterState(),
      departmentIds: new Set(["dept-1"]),
      occupancy: "vacant",
    };
    expect(
      nodeMatchesFilters(
        node({ positionId: "a", departmentId: "dept-1", occupancyStatus: "vacant" }),
        filters
      )
    ).toBe(true);
    // Matches department but not occupancy.
    expect(
      nodeMatchesFilters(
        node({ positionId: "b", departmentId: "dept-1", occupancyStatus: "occupied" }),
        filters
      )
    ).toBe(false);
  });

  it("combined filters returning no matches is a valid, non-error result", () => {
    const nodes = [node({ positionId: "a", departmentId: "dept-1", occupancyStatus: "occupied" })];
    const filters: OrganogramFilterState = {
      ...emptyFilterState(),
      departmentIds: new Set(["dept-1"]),
      occupancy: "vacant",
    };
    expect(computeFilterMatchIds(nodes, filters)).toEqual(new Set());
  });
});

describe("computeFilterMatchIds", () => {
  it("returns only matching position ids, never a context/ancestor id", () => {
    const nodes = [
      node({ positionId: "root", departmentId: "dept-1" }),
      node({ positionId: "match", departmentId: "dept-2" }),
    ];
    const filters: OrganogramFilterState = {
      ...emptyFilterState(),
      departmentIds: new Set(["dept-2"]),
    };
    expect(computeFilterMatchIds(nodes, filters)).toEqual(new Set(["match"]));
  });
});
