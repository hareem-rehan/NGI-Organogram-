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

/**
 * Co-heads (docs/DECISIONS.md D27): a position reports to one or two heads,
 * so the reporting structure is a DAG, not a tree. A position's level is
 * the DEEPEST head's level + 1 (root = 1), so it always sits below both.
 */
export function calculateLevelFromHeads(headLevels: readonly number[]): number {
  return headLevels.length === 0 ? ROOT_LEVEL : Math.max(...headLevels) + 1;
}

/** Thrown when a supposedly acyclic head graph turns out to contain a cycle. */
export class HeadGraphCycleError extends Error {
  constructor(public readonly positionIds: readonly string[]) {
    super(`Reporting cycle detected among positions: ${positionIds.join(", ")}.`);
    this.name = "HeadGraphCycleError";
  }
}

/**
 * Recalculates the level of every AFFECTED position (typically a moved
 * position plus every descendant reachable through either head link),
 * given each one's head ids. A head outside the affected set keeps its
 * stored level, supplied via `fixedLevelOf`. Topological (Kahn) order, so a
 * descendant reached through two paths gets the max of both.
 *
 * A head id with neither an affected entry nor a fixed level is treated as
 * absent (defensive — the caller always fetches every head it references).
 * Throws `HeadGraphCycleError` if the affected set contains a cycle.
 */
export function recalculateDagLevels(
  affected: readonly { id: string; headIds: readonly string[] }[],
  fixedLevelOf: ReadonlyMap<string, number>
): Map<string, number> {
  const affectedIds = new Set(affected.map((n) => n.id));
  const pendingHeadCount = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const node of affected) {
    const internalHeads = new Set(node.headIds.filter((h) => affectedIds.has(h)));
    pendingHeadCount.set(node.id, internalHeads.size);
    for (const head of internalHeads) {
      const list = dependents.get(head) ?? [];
      list.push(node.id);
      dependents.set(head, list);
    }
  }

  const headsById = new Map(affected.map((n) => [n.id, n.headIds]));
  const levels = new Map<string, number>();
  const ready = affected.filter((n) => pendingHeadCount.get(n.id) === 0).map((n) => n.id);

  while (ready.length > 0) {
    const id = ready.shift()!;
    const headLevels: number[] = [];
    for (const head of headsById.get(id) ?? []) {
      const level = levels.get(head) ?? fixedLevelOf.get(head);
      if (level !== undefined) headLevels.push(level);
    }
    levels.set(id, calculateLevelFromHeads(headLevels));
    for (const dependent of dependents.get(id) ?? []) {
      const remaining = (pendingHeadCount.get(dependent) ?? 0) - 1;
      pendingHeadCount.set(dependent, remaining);
      if (remaining === 0) ready.push(dependent);
    }
  }

  if (levels.size !== affected.length) {
    throw new HeadGraphCycleError(affected.filter((n) => !levels.has(n.id)).map((n) => n.id));
  }
  return levels;
}

/**
 * Multi-parent version of `findCycleInGraph` for the co-head DAG: every
 * node's head ids (zero, one or two). Returns the ids on some cycle, or
 * null when acyclic. Iterative three-colour DFS — linear in the graph.
 */
export function findCycleInHeadGraph(
  headsOf: ReadonlyMap<string, readonly string[]>
): string[] | null {
  const state = new Map<string, "visiting" | "done">();

  for (const startId of headsOf.keys()) {
    if (state.has(startId)) continue;
    const stack: { id: string; next: number }[] = [{ id: startId, next: 0 }];
    const path: string[] = [startId];
    state.set(startId, "visiting");

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const heads = headsOf.get(frame.id) ?? [];
      if (frame.next >= heads.length) {
        state.set(frame.id, "done");
        stack.pop();
        path.pop();
        continue;
      }
      const head = heads[frame.next++]!;
      const headState = state.get(head);
      if (headState === "visiting") return path.slice(path.indexOf(head));
      if (headState === "done" || !headsOf.has(head)) continue;
      state.set(head, "visiting");
      stack.push({ id: head, next: 0 });
      path.push(head);
    }
  }
  return null;
}
