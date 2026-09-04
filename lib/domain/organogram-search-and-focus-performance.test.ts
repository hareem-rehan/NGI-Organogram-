import { describe, expect, it } from "vitest";

import { searchOrganogramNodes } from "./organogram-search";
import { computeFilterMatchIds } from "./organogram-filters";
import {
  buildDepartmentFocusVisibleSet,
  buildFilteredVisibleSet,
  buildPositionFocusVisibleSet,
} from "./organogram-focus";
import type { OrganogramNode } from "./organogram";

/**
 * Diagnostic-only performance check for Phase 9's client-side search/
 * filter/focus pipeline at the ~1,000-position representative scale
 * (docs/DECISIONS.md P7) — mirrors the Phase 7/8 precedent
 * (tests/integration/dashboard-performance.integration.test.ts,
 * organogram-performance.integration.test.ts) but for pure in-memory
 * functions, since this phase's search/filter/focus logic never leaves
 * the client (docs/ORGANOGRAM_SEARCH_AND_FOCUS.md "Architecture"). No
 * database involved — this is testing plain JS Set/Map operations over
 * an array already resident in memory.
 */
function buildLargeFixture(width: number, depth: number): OrganogramNode[] {
  const nodes: OrganogramNode[] = [];
  const rootId = "root";
  nodes.push({
    positionId: rootId,
    positionCode: "POS-ROOT",
    title: "Root",
    departmentId: "dept-0",
    departmentName: "Dept 0",
    departmentCode: "D0",
    departmentColor: null,
    jobGradeId: null,
    jobGradeName: null,
    organizationalLevel: 1,
    positionStatus: "ACTIVE",
    occupancyStatus: "vacant",
    occupantDisplayName: null,
    occupantEmployeeId: null,
    directReportCount: width,
    primaryReportsToPositionId: null,
    hasChildren: true,
    isPlanned: false,
    isActive: true,
  });

  let counter = 0;
  for (let branch = 0; branch < width; branch++) {
    let parentId = rootId;
    for (let level = 0; level < depth; level++) {
      counter++;
      const id = `pos-${counter}`;
      const deptIndex = counter % 15;
      nodes.push({
        positionId: id,
        positionCode: `POS-${counter}`,
        title: `Position ${counter}`,
        departmentId: `dept-${deptIndex}`,
        departmentName: `Dept ${deptIndex}`,
        departmentCode: `D${deptIndex}`,
        departmentColor: null,
        jobGradeId: null,
        jobGradeName: null,
        organizationalLevel: level + 2,
        positionStatus: counter % 47 === 0 ? "PLANNED" : counter % 91 === 0 ? "INACTIVE" : "ACTIVE",
        occupancyStatus: counter % 4 === 0 ? "occupied" : "vacant",
        occupantDisplayName: counter % 4 === 0 ? `Employee ${counter}` : null,
        occupantEmployeeId: counter % 4 === 0 ? `emp-${counter}` : null,
        directReportCount: 0,
        primaryReportsToPositionId: parentId,
        hasChildren: false,
        isPlanned: counter % 47 === 0,
        isActive: counter % 47 !== 0 && counter % 91 !== 0,
      });
      parentId = id;
    }
  }
  return nodes;
}

describe("Organogram search/filter/focus performance (diagnostic, ~1,000+ positions)", () => {
  const nodes = buildLargeFixture(30, 35);

  it("has a representative-scale fixture", () => {
    expect(nodes.length).toBeGreaterThan(1000);
  });

  it("search completes quickly across the full fixture", () => {
    const start = performance.now();
    const results = searchOrganogramNodes(nodes, "Position 500");
    const durationMs = performance.now() - start;
    console.log(
      `[search-performance] ${nodes.length} nodes -> search in ${durationMs.toFixed(2)}ms`
    );
    expect(results.length).toBeGreaterThan(0);
    expect(durationMs).toBeLessThan(200);
  });

  it("filter matching completes quickly across the full fixture", () => {
    const start = performance.now();
    const matches = computeFilterMatchIds(nodes, {
      departmentIds: new Set(["dept-3"]),
      levels: new Set(),
      jobGradeIds: new Set(),
      occupancy: "vacant",
      statuses: new Set(),
    });
    const durationMs = performance.now() - start;
    console.log(
      `[filter-performance] ${nodes.length} nodes -> ${matches.size} matches in ${durationMs.toFixed(2)}ms`
    );
    expect(durationMs).toBeLessThan(200);
  });

  it("full-view filtered-context computation completes quickly", () => {
    const matchIds = computeFilterMatchIds(nodes, {
      departmentIds: new Set(["dept-3"]),
      levels: new Set(),
      jobGradeIds: new Set(),
      occupancy: "all",
      statuses: new Set(),
    });
    const start = performance.now();
    const result = buildFilteredVisibleSet(nodes, matchIds);
    const durationMs = performance.now() - start;
    console.log(
      `[filtered-context-performance] ${nodes.length} nodes, ${matchIds.size} matches -> ${result.visibleIds.size} visible in ${durationMs.toFixed(2)}ms`
    );
    expect(durationMs).toBeLessThan(500);
  });

  it("Position Focus (All Descendants from the root) completes quickly", () => {
    const start = performance.now();
    const result = buildPositionFocusVisibleSet(nodes, "root", "all");
    const durationMs = performance.now() - start;
    console.log(
      `[position-focus-performance] ${nodes.length} nodes -> ${result.visibleIds.size} visible in ${durationMs.toFixed(2)}ms`
    );
    expect(result.visibleIds.size).toBe(nodes.length);
    expect(durationMs).toBeLessThan(500);
  });

  it("Department Focus completes quickly", () => {
    const start = performance.now();
    const result = buildDepartmentFocusVisibleSet(nodes, "dept-3");
    const durationMs = performance.now() - start;
    console.log(
      `[department-focus-performance] ${nodes.length} nodes -> ${result.matchIds.size} matches, ${result.visibleIds.size} visible in ${durationMs.toFixed(2)}ms`
    );
    expect(durationMs).toBeLessThan(500);
  });
});
