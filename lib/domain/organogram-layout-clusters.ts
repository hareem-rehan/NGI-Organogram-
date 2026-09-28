/**
 * Department segregation for the organogram layout.
 *
 * Every card under the chart's root belongs to exactly one top-level branch:
 * the branch that starts at one of the root's direct children (in the
 * leadership view, a department heading such as "Engineering" or "Client
 * Delivery Services"). The layout engine lays each branch out inside its own
 * box, side by side, so one department's cards can never drift under — or
 * collide with — a neighbouring department's cards, however wide either
 * branch is. The root itself belongs to no branch and sits above them all.
 *
 * Pure: works on the DISPLAYED tree (each node's display parent), so it
 * applies equally to the leadership view, the raw position tree, and an
 * export subgraph. Visual grouping only — it never changes reporting lines
 * or organizational levels (CLAUDE.md §2).
 */
export interface ClusterInputNode {
  positionId: string;
  /** The node's DISPLAY parent (null for a root of the displayed tree). */
  primaryReportsToPositionId: string | null;
}

/**
 * Maps every non-root node to the id of the top-level branch it belongs to
 * (the root's direct child at the top of its chain; that child maps to
 * itself). Roots, and any node whose chain never reaches a root present in
 * `nodes` (a filtered/partial set), get no entry and are laid out loose.
 */
export function computeLayoutClusters(nodes: readonly ClusterInputNode[]): Map<string, string> {
  const parentOf = new Map(nodes.map((n) => [n.positionId, n.primaryReportsToPositionId]));
  const isRoot = (id: string) => {
    const parent = parentOf.get(id);
    return parent === null || parent === undefined || !parentOf.has(parent);
  };

  const clusterOf = new Map<string, string>();
  for (const node of nodes) {
    if (isRoot(node.positionId)) continue;
    // Walk up to the ancestor whose own parent is a root.
    const path: string[] = [];
    let current = node.positionId;
    let found: string | null = null;
    const seen = new Set<string>();
    while (!seen.has(current)) {
      seen.add(current);
      const known = clusterOf.get(current);
      if (known) {
        found = known;
        break;
      }
      path.push(current);
      const parent = parentOf.get(current);
      if (parent === null || parent === undefined || !parentOf.has(parent)) break;
      if (isRoot(parent)) {
        found = current;
        break;
      }
      current = parent;
    }
    if (found) for (const id of path) clusterOf.set(id, found);
  }
  return clusterOf;
}
