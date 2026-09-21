/**
 * Structural-context computation for Phase 9's Full-View filtering,
 * Position Focus, and Department Focus (docs/ORGANOGRAM_SEARCH_AND_FOCUS.md
 * "False-Edge Prevention"). This is the single place responsible for the
 * phase's critical invariant: **never connect two positions that do not
 * directly report to each other.**
 *
 * How that's guaranteed: every function here only ever computes a
 * NODE-ID SET (matches ∪ ancestor/descendant context). It never builds
 * or modifies an edge. The caller (lib/services/organogram.service.ts's
 * client consumers) always renders edges by filtering the EXISTING,
 * already-server-computed, already-safe `OrganogramEdge[]` down to pairs
 * where both endpoints are in the computed visible set — so a filtered-
 * out intermediary is either pulled back in as non-matching context
 * (preserving the real edge chain) or, if excluded, its child's edge is
 * excluded too. No code path here can ever produce an edge that didn't
 * already exist in the safe, server-computed graph — directly extending
 * .claude/skills/organogram-hierarchy-safety/SKILL.md's "never fabricate
 * a relationship" principle to filtering/focus.
 *
 * The input graph is ALREADY guaranteed acyclic and rooted
 * (lib/domain/organogram.ts's buildOrganogramGraph only ever returns
 * positions analyzeOrganogramSafety judged safe) — so the ancestor walk
 * below needs no cycle detection of its own; it reuses that upstream
 * guarantee rather than re-implementing safety checking (the
 * hierarchy-safety skill's "single source of truth" rule).
 */

export type DescendantDepth = 1 | 2 | 3 | "all";

export interface FocusNodeInput {
  positionId: string;
  primaryReportsToPositionId: string | null;
  departmentId: string;
}

export interface VisibleSetResult {
  /** Positions that directly satisfy the active search/filter/focus criteria. */
  matchIds: Set<string>;
  /** Positions included only to preserve real reporting-chain continuity — never counted as a match/result. */
  contextIds: Set<string>;
  /** matchIds ∪ contextIds ∪ (Position Focus only) depth-limited descendants — the full set eligible to render, before collapse/expand is applied on top via computeVisiblePositionIds's restrictToIds. */
  visibleIds: Set<string>;
}

/** Generous vs. the 2,000-position cap (docs/DECISIONS.md P7) — a defensive bound, not expected to ever trigger on real data since the input is already guaranteed acyclic. */
const MAX_WALK_STEPS = 2100;
const MAX_DESCENDANT_STEPS = 5000;

/**
 * Bounded, iterative walk from `positionId` up to the root via
 * `primaryReportsToPositionId`, INCLUSIVE of the starting position
 * itself. Returns `[]` if `positionId` doesn't exist in `byId` — a
 * missing/inaccessible position is the caller's safe-state signal, not
 * a thrown error.
 */
export function computeAncestorChain(
  positionId: string,
  byId: ReadonlyMap<string, FocusNodeInput>
): string[] {
  const chain: string[] = [];
  let currentId: string | null = positionId;
  let steps = 0;
  while (currentId !== null) {
    if (steps++ > MAX_WALK_STEPS) break;
    const node: FocusNodeInput | undefined = byId.get(currentId);
    if (!node) break;
    chain.push(node.positionId);
    currentId = node.primaryReportsToPositionId;
  }
  return chain;
}

export function buildChildrenByParent(nodes: readonly FocusNodeInput[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.primaryReportsToPositionId) {
      const list = map.get(n.primaryReportsToPositionId) ?? [];
      list.push(n.positionId);
      map.set(n.primaryReportsToPositionId, list);
    }
  }
  return map;
}

/**
 * Bounded, iterative, layer-by-layer BFS down from `positionId` to
 * `depth` levels (`1` = direct reports only, ... , `"all"` = unlimited).
 * A leaf position or a position with no matching depth simply returns an
 * empty set — never an error.
 */
export function computeDescendantIds(
  positionId: string,
  childrenByParent: ReadonlyMap<string, string[]>,
  depth: DescendantDepth
): Set<string> {
  const result = new Set<string>();
  const maxLevel = depth === "all" ? Infinity : depth;
  let frontier = childrenByParent.get(positionId) ?? [];
  let level = 0;
  let steps = 0;

  while (frontier.length > 0 && level < maxLevel) {
    const next: string[] = [];
    for (const id of frontier) {
      if (steps++ > MAX_DESCENDANT_STEPS) return result;
      result.add(id);
      for (const childId of childrenByParent.get(id) ?? []) next.push(childId);
    }
    frontier = next;
    level++;
  }
  return result;
}

/**
 * Full-View filtering/search: every match's full ancestor chain is
 * pulled in as context so no intermediary manager ever disappears from
 * the reporting path — a filtered-out grandparent would otherwise force
 * the match to render with no valid parent at all (never a false edge
 * to a more distant ancestor).
 */
export function buildFilteredVisibleSet(
  nodes: readonly FocusNodeInput[],
  matchIds: ReadonlySet<string>
): VisibleSetResult {
  const byId = new Map(nodes.map((n) => [n.positionId, n]));
  const contextIds = new Set<string>();
  for (const matchId of matchIds) {
    for (const ancestorId of computeAncestorChain(matchId, byId)) {
      if (!matchIds.has(ancestorId)) contextIds.add(ancestorId);
    }
  }
  return {
    matchIds: new Set(matchIds),
    contextIds,
    visibleIds: new Set([...matchIds, ...contextIds]),
  };
}

/**
 * Position Focus: the selected position is the sole "match"; its full
 * ancestor path becomes context (dimmed/labeled), and its descendants
 * down to `depth` render normally (not dimmed — they're the actual
 * subject of the focus, not incidental context, per this phase's Step 8
 * requirement 2, which only calls out ANCESTOR context as visually
 * distinguished). A missing/inaccessible position returns every set
 * empty — the caller renders this as a safe "position not found" state,
 * never a crash or a fabricated placeholder node.
 */
export function buildPositionFocusVisibleSet(
  nodes: readonly FocusNodeInput[],
  selectedPositionId: string,
  depth: DescendantDepth
): VisibleSetResult {
  const byId = new Map(nodes.map((n) => [n.positionId, n]));
  if (!byId.has(selectedPositionId)) {
    return { matchIds: new Set(), contextIds: new Set(), visibleIds: new Set() };
  }

  const childrenByParent = buildChildrenByParent(nodes);
  const ancestorChain = computeAncestorChain(selectedPositionId, byId);
  const descendantIds = computeDescendantIds(selectedPositionId, childrenByParent, depth);

  const matchIds = new Set([selectedPositionId]);
  const contextIds = new Set<string>();
  for (const id of ancestorChain) {
    if (id !== selectedPositionId) contextIds.add(id);
  }

  return {
    matchIds,
    contextIds,
    visibleIds: new Set([...matchIds, ...contextIds, ...descendantIds]),
  };
}

/**
 * Department Focus: every position whose OWN `departmentId` is the
 * selected department is a match (never inferred/guessed — department
 * membership is strictly position-based, per this phase's Step 9
 * requirement 1). Each match's ancestor chain is pulled in as context,
 * which is exactly how a cross-department manager position correctly
 * appears (labeled Context, never re-attributed to this department).
 */
export function buildDepartmentFocusVisibleSet(
  nodes: readonly FocusNodeInput[],
  departmentId: string
): VisibleSetResult {
  const matchIds = new Set(
    nodes.filter((n) => n.departmentId === departmentId).map((n) => n.positionId)
  );
  return buildFilteredVisibleSet(nodes, matchIds);
}
