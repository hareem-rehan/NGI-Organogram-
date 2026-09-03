/**
 * Pure hierarchy business rules (docs/DOMAIN_MODEL.md §5, §7). No Prisma
 * import here on purpose — these functions operate on plain data already
 * fetched by the caller, so they're testable with in-memory fixtures and
 * reusable regardless of how the data was loaded.
 *
 * The DB-aware orchestration (fetching ancestor chains, running these
 * checks inside a transaction, persisting recalculated levels) lives in
 * lib/services/hierarchy.service.ts.
 */

export const ROOT_LEVEL = 1;

/**
 * A defensive ceiling on reporting-chain depth. Cycle prevention should
 * make a chain this deep unreachable in practice; this guard exists so a
 * corrupted/disconnected chain (docs/NEGATIVE_SCENARIOS.md "excessively
 * deep hierarchy" / "orphaned or disconnected hierarchy data") fails
 * loudly with a clear error instead of looping indefinitely.
 */
export const MAX_HIERARCHY_DEPTH = 200;

export class HierarchyDepthExceededError extends Error {
  constructor(limit: number) {
    super(
      `Reporting chain exceeded ${limit} levels — this indicates disconnected or corrupted hierarchy data, not a legitimately deep org chart.`
    );
    this.name = "HierarchyDepthExceededError";
  }
}

/**
 * Would setting `positionId`'s primary parent to a position whose
 * ancestor chain (from the proposed parent itself up through the root,
 * inclusive) is `proposedParentAncestorChain` create a cycle?
 *
 * This single check covers all three cycle shapes:
 * - Self-report: the proposed parent chain's first element IS positionId.
 * - Direct cycle (A→B, B→A): positionId appears as the proposed parent's
 *   own current parent.
 * - Indirect cycle (A→B→C→A): positionId appears anywhere further up the
 *   chain.
 */
export function wouldCreateCycle(
  positionId: string,
  proposedParentAncestorChain: readonly string[]
): boolean {
  return proposedParentAncestorChain.includes(positionId);
}

/** Root has level 1; every child is exactly one level below its parent. */
export function calculateLevel(parentLevel: number | null): number {
  return parentLevel === null ? ROOT_LEVEL : parentLevel + 1;
}

export interface PositionNode {
  id: string;
  title: string;
  organizationalLevel: number;
}

/**
 * Assembles a root-first reporting path (e.g. for breadcrumbs) from an
 * ancestor chain ordered "self, parent, grandparent, ..., root".
 */
export function buildReportingPath(selfToRootChain: readonly PositionNode[]): PositionNode[] {
  return [...selfToRootChain].reverse();
}

/**
 * Given the current level of every position in a subtree (root of the
 * subtree first), returns the corrected level for each, after the
 * subtree's root has a new parent level. Used when moving a branch: the
 * moved position and every descendant need their stored level updated in
 * the same transaction (docs/adr/0005-transaction-strategy.md).
 */
export function recalculateSubtreeLevels(
  subtreeRootId: string,
  newParentLevel: number | null,
  subtree: readonly { id: string; parentId: string | null; currentLevel: number }[]
): Map<string, number> {
  const levelById = new Map<string, number>();
  const childrenByParent = new Map<string, string[]>();

  for (const node of subtree) {
    if (node.parentId !== null) {
      const siblings = childrenByParent.get(node.parentId) ?? [];
      siblings.push(node.id);
      childrenByParent.set(node.parentId, siblings);
    }
  }

  const rootLevel = calculateLevel(newParentLevel);
  levelById.set(subtreeRootId, rootLevel);

  const queue: string[] = [subtreeRootId];
  let iterations = 0;
  while (queue.length > 0) {
    if (iterations++ > MAX_HIERARCHY_DEPTH * subtree.length + 1) {
      throw new HierarchyDepthExceededError(MAX_HIERARCHY_DEPTH);
    }
    const currentId = queue.shift();
    if (currentId === undefined) break;
    const currentLevel = levelById.get(currentId);
    if (currentLevel === undefined) continue;
    const children = childrenByParent.get(currentId) ?? [];
    for (const childId of children) {
      levelById.set(childId, calculateLevel(currentLevel));
      queue.push(childId);
    }
  }

  return levelById;
}

/**
 * Detects a cycle anywhere in a proposed FULL parent graph — every node's
 * parent id (or null for a root), covering both rows a bulk operation is
 * about to write AND every unchanged existing row it depends on. Unlike
 * `wouldCreateCycle` (which checks one candidate move against an already-
 * fetched ancestor chain), this walks the whole graph at once — the shape
 * CSV import's "combined-state validation" needs (docs/adr/0007-import-
 * strategy.md): two individually-valid parent changes can still form a
 * cycle together, and row order in the source file must not matter.
 *
 * Returns the first cycle found as an ordered id list (e.g. ["A","B","C"]
 * for A→B→C→A), or null if the graph is acyclic. Every node is walked at
 * most once overall (not once per starting node), so this is linear in
 * the graph size, not quadratic.
 */
export function findCycleInGraph(parentOf: ReadonlyMap<string, string | null>): string[] | null {
  const state = new Map<string, "visiting" | "done">();

  for (const startId of parentOf.keys()) {
    if (state.get(startId) === "done") continue;

    const path: string[] = [];
    let currentId: string | undefined = startId;
    let steps = 0;

    while (currentId !== undefined) {
      if (++steps > MAX_HIERARCHY_DEPTH + parentOf.size + 1) {
        throw new HierarchyDepthExceededError(MAX_HIERARCHY_DEPTH);
      }

      const currentState = state.get(currentId);
      if (currentState === "done") break;
      if (currentState === "visiting") {
        const cycleStart = path.indexOf(currentId);
        return path.slice(cycleStart);
      }

      state.set(currentId, "visiting");
      path.push(currentId);
      const parentId = parentOf.get(currentId);
      currentId = parentId === null || parentId === undefined ? undefined : parentId;
    }

    for (const id of path) state.set(id, "done");
  }

  return null;
}
