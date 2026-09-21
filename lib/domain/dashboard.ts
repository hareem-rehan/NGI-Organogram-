/**
 * Pure dashboard-metric business rules (docs/DASHBOARD_METRICS.md). No
 * Prisma import here on purpose — these functions operate on plain data
 * already fetched by the caller (lib/services/dashboard.service.ts), so
 * they're testable with in-memory fixtures and don't duplicate the
 * vacancy/occupancy/level logic already owned by lib/domain/assignment.ts
 * and lib/domain/hierarchy.ts (this file only adds aggregation on top of
 * those, never a second definition of what "occupied" or "level" means).
 */

export interface VacancyRate {
  vacantCount: number;
  eligibleCount: number;
  /** null when eligibleCount is 0 — "not applicable," never 0%/NaN/Infinity. */
  percent: number | null;
}

/**
 * vacancy rate = vacant active positions / total eligible active positions × 100,
 * rounded to the nearest whole percentage point. Division-by-zero-safe.
 */
export function calculateVacancyRate(vacantCount: number, eligibleCount: number): VacancyRate {
  return {
    vacantCount,
    eligibleCount,
    percent: eligibleCount === 0 ? null : Math.round((vacantCount / eligibleCount) * 100),
  };
}

export interface LevelCount {
  level: number;
  count: number;
}

/** Active-position count grouped by organizationalLevel, sorted ascending. Levels with zero active positions between 1 and the max are omitted (not padded with zero rows) — the caller renders only levels that actually exist. */
export function buildLevelDistribution(
  activePositions: readonly { organizationalLevel: number }[]
): LevelCount[] {
  const counts = new Map<number, number>();
  for (const position of activePositions) {
    counts.set(position.organizationalLevel, (counts.get(position.organizationalLevel) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([level, count]) => ({ level, count }))
    .sort((a, b) => a.level - b.level);
}

/** Highest organizationalLevel among active positions, or null if there are none. */
export function findMaxLevel(
  activePositions: readonly { organizationalLevel: number }[]
): number | null {
  if (activePositions.length === 0) return null;
  return Math.max(...activePositions.map((p) => p.organizationalLevel));
}

export interface HierarchySnapshotNode {
  id: string;
  status: "PLANNED" | "ACTIVE" | "INACTIVE";
  primaryReportsToPositionId: string | null;
}

export interface HierarchyIntegrityResult {
  /** The single position with no primary manager, or null if the company has no positions at all. */
  rootId: string | null;
  /** Always empty under the current schema (a DB partial unique index makes this unreachable) — see docs/DASHBOARD_METRICS.md §H. Kept for forward-compatibility. */
  extraRootIds: string[];
  /** Active positions whose ancestor walk revisits a node already seen in that same walk. */
  cycleActivePositionIds: string[];
  /** Active positions whose ancestor walk terminates somewhere other than the true root (dangling parent, or the walk's own bound was exceeded) without being a detected cycle. */
  disconnectedActivePositionIds: string[];
}

export const MAX_WALK_STEPS = 200;

/**
 * Walks `startId`'s ancestor chain (via `primaryReportsToPositionId`,
 * across ANY status — an archived manager in the chain is still a valid
 * connection, docs/DOMAIN_MODEL.md §8) until it reaches a null parent, a
 * missing/dangling parent, a previously-seen node in this same walk
 * (cycle), or MAX_WALK_STEPS. Iterative, not recursive — a corrupted
 * cycle can never cause a stack overflow or an infinite loop here.
 *
 * Exported so lib/domain/organogram.ts (Phase 8) can reuse this exact
 * primitive for its own (all-status, not just ACTIVE) safety pass rather
 * than a second implementation — the organogram-hierarchy-safety skill's
 * "single source of truth" requirement.
 */
export function walkToRoot(
  startId: string,
  byId: ReadonlyMap<string, HierarchySnapshotNode>
): { terminalId: string | null; cycle: boolean } {
  const visited = new Set<string>();
  let currentId: string | null = startId;
  let steps = 0;

  while (currentId !== null) {
    if (steps++ > MAX_WALK_STEPS) return { terminalId: null, cycle: false };
    if (visited.has(currentId)) return { terminalId: null, cycle: true };
    visited.add(currentId);
    const node: HierarchySnapshotNode | undefined = byId.get(currentId);
    if (!node) return { terminalId: null, cycle: false };
    if (node.primaryReportsToPositionId === null) return { terminalId: node.id, cycle: false };
    currentId = node.primaryReportsToPositionId;
  }
  return { terminalId: null, cycle: false };
}

/**
 * Detects the structural data-quality warnings described in
 * docs/DASHBOARD_METRICS.md §H that require walking the reporting graph
 * (as opposed to a single-table count/groupBy, which the repository
 * layer handles directly). Takes a snapshot of ALL positions in the
 * company (any status — required so a chain through an archived manager
 * isn't misreported as disconnected) and reports only on ACTIVE
 * positions, matching "active-position totals exclude inactive/planned."
 */
export function detectHierarchyIntegrityWarnings(
  allPositions: readonly HierarchySnapshotNode[]
): HierarchyIntegrityResult {
  const byId = new Map(allPositions.map((p) => [p.id, p]));
  const roots = allPositions.filter((p) => p.primaryReportsToPositionId === null);
  const rootId = roots[0]?.id ?? null;
  const extraRootIds = roots.slice(1).map((r) => r.id);

  const cycleActivePositionIds: string[] = [];
  const disconnectedActivePositionIds: string[] = [];

  for (const position of allPositions) {
    if (position.status !== "ACTIVE") continue;
    const { terminalId, cycle } = walkToRoot(position.id, byId);
    if (cycle) {
      cycleActivePositionIds.push(position.id);
    } else if (rootId === null || terminalId !== rootId) {
      disconnectedActivePositionIds.push(position.id);
    }
  }

  return { rootId, extraRootIds, cycleActivePositionIds, disconnectedActivePositionIds };
}
