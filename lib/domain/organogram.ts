/**
 * Pure organogram graph-building rules (docs/ORGANOGRAM_RENDERING.md). No
 * Prisma import here on purpose — operates on plain data already fetched
 * by lib/services/organogram.service.ts, so it's testable with in-memory
 * fixtures. Reuses lib/domain/dashboard.ts's `walkToRoot` (the same
 * bounded, non-recursive ancestor-chain primitive Phase 7 already
 * established) rather than a second hierarchy-safety implementation —
 * the organogram-hierarchy-safety skill's "single source of truth" rule.
 */
import { walkToRoot, type HierarchySnapshotNode } from "@/lib/domain/dashboard";

export interface OrganogramSafetyResult {
  /** The single position with no primary manager, or null if the company has no positions at all. */
  rootPositionId: string | null;
  /** Always empty under the current schema (DB-enforced, see docs/DASHBOARD_METRICS.md §H) — kept for forward-compatibility. */
  extraRootIds: string[];
  /** Any-status positions whose ancestor walk revisits a node already seen in that same walk. */
  cyclePositionIds: string[];
  /** Any-status positions whose ancestor walk terminates somewhere other than the true root (dangling parent, or the walk's bound was exceeded), and are not part of a detected cycle. */
  disconnectedPositionIds: string[];
  /** Positions safe to render — connected to the true root with no cycle. Corrupted positions are isolated (excluded), never rendered with a fabricated relationship. */
  safePositionIds: ReadonlySet<string>;
}

/**
 * Unlike lib/domain/dashboard.ts's `detectHierarchyIntegrityWarnings`
 * (which reports only on ACTIVE positions, matching the dashboard's
 * "active-position totals" framing), the organogram must render
 * PLANNED/INACTIVE positions too — so this checks the safety of EVERY
 * position, any status, and returns the exact set safe to render.
 */
export function analyzeOrganogramSafety(
  allPositions: readonly HierarchySnapshotNode[]
): OrganogramSafetyResult {
  const byId = new Map(allPositions.map((p) => [p.id, p]));
  const roots = allPositions.filter((p) => p.primaryReportsToPositionId === null);
  const rootPositionId = roots[0]?.id ?? null;
  const extraRootIds = roots.slice(1).map((r) => r.id);

  const cyclePositionIds: string[] = [];
  const disconnectedPositionIds: string[] = [];
  const safePositionIds = new Set<string>();

  for (const position of allPositions) {
    const { terminalId, cycle } = walkToRoot(position.id, byId);
    if (cycle) {
      cyclePositionIds.push(position.id);
    } else if (rootPositionId === null || terminalId !== rootPositionId) {
      disconnectedPositionIds.push(position.id);
    } else {
      safePositionIds.add(position.id);
    }
  }

  return {
    rootPositionId,
    extraRootIds,
    cyclePositionIds,
    disconnectedPositionIds,
    safePositionIds,
  };
}

export type PositionStatus = "PLANNED" | "ACTIVE" | "INACTIVE";
export type OccupancyStatus = "occupied" | "vacant";

export interface OrganogramPositionInput {
  id: string;
  positionCode: string;
  title: string;
  departmentId: string;
  jobGradeId: string | null;
  organizationalLevel: number;
  status: PositionStatus;
  primaryReportsToPositionId: string | null;
}

export interface OrganogramDepartmentInput {
  id: string;
  name: string;
  code: string;
  color: string | null;
}

export interface OrganogramNode {
  positionId: string;
  positionCode: string;
  title: string;
  departmentId: string;
  departmentName: string;
  departmentCode: string;
  departmentColor: string | null;
  /** Stable id for Phase 9's job-grade filter (matching how departmentId, not departmentName, drives department filtering) — the grade's own name/existence was already visible via jobGradeName, so this exposes no new information. */
  jobGradeId: string | null;
  jobGradeName: string | null;
  organizationalLevel: number;
  positionStatus: PositionStatus;
  occupancyStatus: OccupancyStatus;
  occupantDisplayName: string | null;
  /** Present only when occupied — lets an authorized viewer navigate to the employee's own (independently authorization-gated) detail page. Never a substitute for exposing the raw Employee record. */
  occupantEmployeeId: string | null;
  directReportCount: number;
  primaryReportsToPositionId: string | null;
  hasChildren: boolean;
  isPlanned: boolean;
  isActive: boolean;
}

export interface OrganogramEdge {
  sourcePositionId: string;
  targetPositionId: string;
  reportingType: "PRIMARY";
}

/**
 * Builds the full node/edge set for every SAFE position (see
 * analyzeOrganogramSafety) — never per-node queries, one pass over
 * already-fetched data. Deterministic ordering: level, then title, then
 * position code, so two requests against unchanged data always return
 * the identical array order (docs/ORGANOGRAM_RENDERING.md "Deterministic
 * ordering").
 */
export function buildOrganogramGraph(args: {
  positions: readonly OrganogramPositionInput[];
  safePositionIds: ReadonlySet<string>;
  departmentsById: ReadonlyMap<string, OrganogramDepartmentInput>;
  jobGradeNamesById: ReadonlyMap<string, string>;
  occupantNamesByPositionId: ReadonlyMap<string, string>;
  occupantEmployeeIdsByPositionId: ReadonlyMap<string, string>;
}): { nodes: OrganogramNode[]; edges: OrganogramEdge[] } {
  const {
    positions,
    safePositionIds,
    departmentsById,
    jobGradeNamesById,
    occupantNamesByPositionId,
    occupantEmployeeIdsByPositionId,
  } = args;

  const safePositions = positions.filter((p) => safePositionIds.has(p.id));
  const safeIdSet = new Set(safePositions.map((p) => p.id));

  const childCounts = new Map<string, number>();
  for (const p of safePositions) {
    if (p.primaryReportsToPositionId && safeIdSet.has(p.primaryReportsToPositionId)) {
      childCounts.set(
        p.primaryReportsToPositionId,
        (childCounts.get(p.primaryReportsToPositionId) ?? 0) + 1
      );
    }
  }

  const nodes: OrganogramNode[] = safePositions
    .map((p): OrganogramNode => {
      const department = departmentsById.get(p.departmentId);
      const occupantDisplayName = occupantNamesByPositionId.get(p.id) ?? null;
      // A corrupted position's own parent may itself have been excluded
      // as unsafe — never point an edge at a node that won't be
      // rendered (no dangling edges, docs/NEGATIVE_SCENARIOS.md ORG15).
      const safeParentId =
        p.primaryReportsToPositionId && safeIdSet.has(p.primaryReportsToPositionId)
          ? p.primaryReportsToPositionId
          : null;
      return {
        positionId: p.id,
        positionCode: p.positionCode,
        title: p.title,
        departmentId: p.departmentId,
        departmentName: department?.name ?? "Unknown Department",
        departmentCode: department?.code ?? "—",
        departmentColor: department?.color ?? null,
        jobGradeId: p.jobGradeId,
        jobGradeName: p.jobGradeId ? (jobGradeNamesById.get(p.jobGradeId) ?? null) : null,
        organizationalLevel: p.organizationalLevel,
        positionStatus: p.status,
        occupancyStatus: occupantDisplayName ? "occupied" : "vacant",
        occupantDisplayName,
        occupantEmployeeId: occupantEmployeeIdsByPositionId.get(p.id) ?? null,
        directReportCount: childCounts.get(p.id) ?? 0,
        primaryReportsToPositionId: safeParentId,
        hasChildren: (childCounts.get(p.id) ?? 0) > 0,
        isPlanned: p.status === "PLANNED",
        isActive: p.status === "ACTIVE",
      };
    })
    .sort(
      (a, b) =>
        a.organizationalLevel - b.organizationalLevel ||
        a.title.localeCompare(b.title) ||
        a.positionCode.localeCompare(b.positionCode)
    );

  const edges: OrganogramEdge[] = nodes
    .filter((n) => n.primaryReportsToPositionId !== null)
    .map((n) => ({
      sourcePositionId: n.primaryReportsToPositionId!,
      targetPositionId: n.positionId,
      reportingType: "PRIMARY" as const,
    }))
    .sort(
      (a, b) =>
        a.sourcePositionId.localeCompare(b.sourcePositionId) ||
        a.targetPositionId.localeCompare(b.targetPositionId)
    );

  return { nodes, edges };
}

export interface VisibilityInput {
  positionId: string;
  primaryReportsToPositionId: string | null;
  isPlanned: boolean;
}

/**
 * Computes the visible-node id set for the current expand/collapse + planned-toggle
 * UI state, given the FULL node set the server already returned (never a
 * second network request). Iterative (explicit stack), not recursive —
 * bounded by the node count, safe even in principle against a
 * pathological input, though the input here is always already
 * cycle-free (buildOrganogramGraph only includes safe positions).
 *
 * `restrictToIds` (Phase 9) additionally confines the traversal to a
 * search/filter/focus-computed subtree (lib/domain/organogram-filters.ts,
 * organogram-focus.ts) — a node outside that set is treated as absent for
 * traversal purposes, so collapse/expand continues to work *within* a
 * focused/filtered view instead of needing a second, parallel visibility
 * implementation (docs/ORGANOGRAM_SEARCH_AND_FOCUS.md "Structural-Context
 * Strategy"). Omitted (the Phase 8 call shape), it behaves exactly as
 * before — verified by the unchanged Phase 8 regression suite.
 */
export function computeVisiblePositionIds(args: {
  allNodes: readonly VisibilityInput[];
  collapsedIds: ReadonlySet<string>;
  showPlanned: boolean;
  restrictToIds?: ReadonlySet<string>;
}): Set<string> {
  const { allNodes, collapsedIds, showPlanned, restrictToIds } = args;
  const byId = new Map(allNodes.map((n) => [n.positionId, n]));
  const childrenByParent = new Map<string, string[]>();
  for (const n of allNodes) {
    if (n.primaryReportsToPositionId) {
      const list = childrenByParent.get(n.primaryReportsToPositionId) ?? [];
      list.push(n.positionId);
      childrenByParent.set(n.primaryReportsToPositionId, list);
    }
  }
  const roots = allNodes.filter(
    (n) => n.primaryReportsToPositionId === null || !byId.has(n.primaryReportsToPositionId)
  );

  const visible = new Set<string>();
  const stack: string[] = roots.map((r) => r.positionId);
  const maxIterations = allNodes.length * 2 + 10;
  let iterations = 0;

  while (stack.length > 0) {
    if (iterations++ > maxIterations) break;
    const id = stack.pop();
    if (id === undefined) continue;
    const node = byId.get(id);
    if (!node) continue;
    if (!showPlanned && node.isPlanned) continue;
    if (restrictToIds && !restrictToIds.has(id)) continue;
    visible.add(id);
    if (collapsedIds.has(id)) continue;
    for (const childId of childrenByParent.get(id) ?? []) stack.push(childId);
  }

  return visible;
}

/** Total descendant count (not just direct children) hidden behind a collapsed node — shown on the node as "+N hidden." */
export function countHiddenDescendants(
  positionId: string,
  allNodes: readonly VisibilityInput[]
): number {
  const childrenByParent = new Map<string, string[]>();
  for (const n of allNodes) {
    if (n.primaryReportsToPositionId) {
      const list = childrenByParent.get(n.primaryReportsToPositionId) ?? [];
      list.push(n.positionId);
      childrenByParent.set(n.primaryReportsToPositionId, list);
    }
  }
  let count = 0;
  const stack = [...(childrenByParent.get(positionId) ?? [])];
  const maxIterations = allNodes.length + 10;
  let iterations = 0;
  while (stack.length > 0) {
    if (iterations++ > maxIterations) break;
    const id = stack.pop();
    if (id === undefined) continue;
    count++;
    for (const childId of childrenByParent.get(id) ?? []) stack.push(childId);
  }
  return count;
}
