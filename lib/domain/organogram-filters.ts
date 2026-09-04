/**
 * Pure organogram filter matching (Phase 9, docs/ORGANOGRAM_SEARCH_AND_FOCUS.md).
 * A filter only ever decides which SAFE, already-server-computed nodes
 * count as a "match" — it never touches edges and never fabricates a
 * relationship. Combining this with organogram-focus.ts's ancestor-context
 * computation is what prevents a false reporting line from ever
 * appearing (.claude/skills/organogram-hierarchy-safety/SKILL.md).
 */
import type { OccupancyStatus, OrganogramNode, PositionStatus } from "@/lib/domain/organogram";

export type OccupancyFilter = "all" | OccupancyStatus;

/** `null` inside jobGradeIds represents "Not Assigned" (Position.jobGradeId IS NULL) — never confused with "no filter applied" (an empty set). */
export interface OrganogramFilterState {
  departmentIds: ReadonlySet<string>;
  levels: ReadonlySet<number>;
  jobGradeIds: ReadonlySet<string | null>;
  occupancy: OccupancyFilter;
  statuses: ReadonlySet<PositionStatus>;
}

export function emptyFilterState(): OrganogramFilterState {
  return {
    departmentIds: new Set(),
    levels: new Set(),
    jobGradeIds: new Set(),
    occupancy: "all",
    statuses: new Set(),
  };
}

/** An empty per-field set means "no restriction on this field" — never "matches nothing." Only occupancy has a meaningful non-empty default ("all"). */
export function isAnyFilterActive(filters: OrganogramFilterState): boolean {
  return (
    filters.departmentIds.size > 0 ||
    filters.levels.size > 0 ||
    filters.jobGradeIds.size > 0 ||
    filters.occupancy !== "all" ||
    filters.statuses.size > 0
  );
}

/**
 * A node matches only if it satisfies EVERY active filter field (AND
 * across fields, OR within a multi-select field's own values) — combined
 * filters narrow the result set, never widen it.
 */
export function nodeMatchesFilters(node: OrganogramNode, filters: OrganogramFilterState): boolean {
  if (filters.departmentIds.size > 0 && !filters.departmentIds.has(node.departmentId)) return false;
  if (filters.levels.size > 0 && !filters.levels.has(node.organizationalLevel)) return false;
  if (filters.jobGradeIds.size > 0 && !filters.jobGradeIds.has(node.jobGradeId)) return false;
  if (filters.occupancy !== "all" && node.occupancyStatus !== filters.occupancy) return false;
  if (filters.statuses.size > 0 && !filters.statuses.has(node.positionStatus)) return false;
  return true;
}

/** The full set of positionIds satisfying every active filter — never includes a node solely because it's structural context (that's organogram-focus.ts's job). */
export function computeFilterMatchIds(
  nodes: readonly OrganogramNode[],
  filters: OrganogramFilterState
): Set<string> {
  const matches = new Set<string>();
  for (const node of nodes) {
    if (nodeMatchesFilters(node, filters)) matches.add(node.positionId);
  }
  return matches;
}
