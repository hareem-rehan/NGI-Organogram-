import type { OrganogramEdge, OrganogramNode } from "@/lib/domain/organogram";
import { computeFilterMatchIds, type OrganogramFilterState } from "@/lib/domain/organogram-filters";
import {
  buildDepartmentFocusVisibleSet,
  buildFilteredVisibleSet,
  buildPositionFocusVisibleSet,
  type DescendantDepth,
} from "@/lib/domain/organogram-focus";

import type { ExportFilterState, ExportScope } from "./types";

export type ExportMatchState = "none" | "match" | "context";

export interface ExportSubgraphNode extends OrganogramNode {
  matchState: ExportMatchState;
}

export interface ExportSubgraphResult {
  nodes: ExportSubgraphNode[];
  edges: OrganogramEdge[];
  /** True when a POSITION_FOCUS/DEPARTMENT_FOCUS/CURRENT_VIEW-with-focus request named a position/department that doesn't resolve in this company's data — the caller renders a safe "not found" result, never an empty/fabricated chart. */
  focusTargetMissing: boolean;
}

function toFilterState(filters: ExportFilterState): OrganogramFilterState {
  return {
    departmentIds: new Set(filters.departmentIds),
    levels: new Set(filters.levels),
    jobGradeIds: new Set(filters.jobGradeIds),
    occupancy: filters.occupancy,
    statuses: new Set(filters.statuses),
  };
}

function isAnyFilterActive(filters: ExportFilterState): boolean {
  return (
    filters.departmentIds.length > 0 ||
    filters.levels.length > 0 ||
    filters.jobGradeIds.length > 0 ||
    filters.occupancy !== "all" ||
    filters.statuses.length > 0
  );
}

/**
 * Builds the authorized export subgraph by reusing the EXACT same Phase 9
 * focus/filter functions the interactive chart uses — never a
 * reimplementation (organogram-hierarchy-safety skill). `allNodes`/
 * `allEdges` must already be the caller's own already-company-scoped
 * `getOrganogramData()` result; this function does no data fetching and
 * accepts no companyId, so there is no code path for it to see another
 * company's data.
 *
 * Edges are always derived by filtering `allEdges` (the already-safe,
 * server-computed primary-reporting edge list) down to pairs where BOTH
 * endpoints are in the computed visible-id set — identical to
 * `organogram-canvas.tsx`'s own edge-rendering rule. No edge is ever
 * constructed here.
 */
export function buildExportSubgraph(
  allNodes: readonly OrganogramNode[],
  allEdges: readonly OrganogramEdge[],
  options: {
    scope: ExportScope;
    selectedPositionId: string | null;
    selectedDepartmentId: string | null;
    descendantDepth: DescendantDepth;
    includePlanned: boolean;
    filters: ExportFilterState;
  }
): ExportSubgraphResult {
  const plannedFilteredNodes = options.includePlanned
    ? allNodes
    : allNodes.filter((n) => !n.isPlanned);

  const focusInputs = plannedFilteredNodes.map((n) => ({
    positionId: n.positionId,
    primaryReportsToPositionId: n.primaryReportsToPositionId,
    departmentId: n.departmentId,
  }));

  let matchIds: ReadonlySet<string>;
  let contextIds: ReadonlySet<string>;
  let visibleIds: ReadonlySet<string>;
  let focusTargetMissing = false;

  if (
    options.scope === "POSITION_FOCUS" ||
    (options.scope === "CURRENT_VIEW" && options.selectedPositionId)
  ) {
    const positionId = options.selectedPositionId;
    if (!positionId) {
      return { nodes: [], edges: [], focusTargetMissing: true };
    }
    const result = buildPositionFocusVisibleSet(focusInputs, positionId, options.descendantDepth);
    matchIds = result.matchIds;
    contextIds = result.contextIds;
    visibleIds = result.visibleIds;
    focusTargetMissing = visibleIds.size === 0;
  } else if (
    options.scope === "DEPARTMENT_FOCUS" ||
    (options.scope === "CURRENT_VIEW" && options.selectedDepartmentId)
  ) {
    const departmentId = options.selectedDepartmentId;
    if (!departmentId) {
      return { nodes: [], edges: [], focusTargetMissing: true };
    }
    const result = buildDepartmentFocusVisibleSet(focusInputs, departmentId);
    matchIds = result.matchIds;
    contextIds = result.contextIds;
    visibleIds = result.visibleIds;
    focusTargetMissing = visibleIds.size === 0;
  } else if (options.scope === "CURRENT_VIEW" && isAnyFilterActive(options.filters)) {
    const filterMatchIds = computeFilterMatchIds(
      plannedFilteredNodes,
      toFilterState(options.filters)
    );
    const result = buildFilteredVisibleSet(focusInputs, filterMatchIds);
    matchIds = result.matchIds;
    contextIds = result.contextIds;
    visibleIds = result.visibleIds;
  } else {
    // FULL_COMPANY, or CURRENT_VIEW with no active filter/focus — the
    // entire (planned-filtered) graph, no match/context distinction.
    matchIds = new Set();
    contextIds = new Set();
    visibleIds = new Set(plannedFilteredNodes.map((n) => n.positionId));
  }

  const visibleNodeSet = new Set(visibleIds);
  const nodes: ExportSubgraphNode[] = plannedFilteredNodes
    .filter((n) => visibleNodeSet.has(n.positionId))
    .map((n) => ({
      ...n,
      matchState: matchIds.has(n.positionId)
        ? "match"
        : contextIds.has(n.positionId)
          ? "context"
          : "none",
    }));

  const edges = allEdges.filter(
    (e) => visibleNodeSet.has(e.sourcePositionId) && visibleNodeSet.has(e.targetPositionId)
  );

  return { nodes, edges, focusTargetMissing };
}
