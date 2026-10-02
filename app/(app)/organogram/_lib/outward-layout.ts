/**
 * Outward-growing department branches (user request, 2026-10-02). After ELK
 * has laid the chart out (rows, department boxes, saved order), each
 * department's branch is re-placed horizontally as a tidy tree:
 *
 *   - departments on the LEFT half grow to the left — every manager sits
 *     above the inner (right) edge of its reports, which spread outward;
 *   - departments on the RIGHT half grow to the right, the mirror image;
 *   - the middle department (an odd count) stays centred.
 *
 * So branches spread away from the centre instead of crowding towards it.
 * Rows (y) are ELK's and never change, and department boxes keep their
 * left-to-right order. Every subtree gets its own column span, so cards
 * never overlap. A card with two heads is placed under the head drawn
 * directly above it (the other line still connects). Pure: no ELK, no DOM.
 */

export type GrowDirection = "left" | "right" | "balanced";

export interface Point {
  x: number;
  y: number;
}

/** Which way the i-th of `count` department branches grows. */
export function growDirectionFor(index: number, count: number): GrowDirection {
  const middle = (count - 1) / 2;
  if (index < middle) return "left";
  if (index > middle) return "right";
  return "balanced";
}

interface Edge {
  sourcePositionId: string;
  targetPositionId: string;
}

/**
 * Lays one department's cards out as a tree growing in `direction`, from
 * x = 0. Returns the new positions (same y as given) and the branch width.
 */
export function layoutBranch(
  memberIds: readonly string[],
  positions: ReadonlyMap<string, Point>,
  edges: readonly Edge[],
  direction: GrowDirection,
  nodeWidth: number,
  gap: number
): { placed: Map<string, Point>; width: number } {
  const members = new Set(memberIds);
  const xOf = (id: string) => positions.get(id)?.x ?? 0;
  const yOf = (id: string) => positions.get(id)?.y ?? 0;

  // Each card's parent: the in-branch head drawn on the nearest row above it.
  const parentOf = new Map<string, string>();
  for (const id of memberIds) {
    let best: string | null = null;
    for (const e of edges) {
      if (e.targetPositionId !== id || !members.has(e.sourcePositionId)) continue;
      if (yOf(e.sourcePositionId) >= yOf(id)) continue;
      if (best === null || yOf(e.sourcePositionId) > yOf(best)) best = e.sourcePositionId;
    }
    if (best) parentOf.set(id, best);
  }
  // Children and roots in ELK's own left-to-right order (the saved order).
  const byX = [...memberIds].sort((a, b) => xOf(a) - xOf(b));
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const id of byX) {
    const parent = parentOf.get(id);
    if (parent) children.set(parent, [...(children.get(parent) ?? []), id]);
    else roots.push(id);
  }

  const span = new Map<string, number>();
  const spanOf = (id: string, seen = new Set<string>()): number => {
    if (span.has(id)) return span.get(id)!;
    if (seen.has(id)) return nodeWidth; // defensive: never loop
    seen.add(id);
    const kids = children.get(id) ?? [];
    const width =
      kids.length === 0
        ? nodeWidth
        : Math.max(
            nodeWidth,
            kids.reduce((sum, k) => sum + spanOf(k, seen), 0) + gap * (kids.length - 1)
          );
    span.set(id, width);
    return width;
  };

  const placed = new Map<string, Point>();
  const place = (id: string, left: number) => {
    const kids = children.get(id) ?? [];
    const width = spanOf(id);
    const childrenWidth =
      kids.reduce((sum, k) => sum + spanOf(k), 0) + gap * Math.max(0, kids.length - 1);
    // The children block sits at the outer side of this subtree's span.
    let cursor =
      direction === "left"
        ? left + width - childrenWidth
        : direction === "right"
          ? left
          : left + (width - childrenWidth) / 2;
    const childXs: number[] = [];
    for (const kid of kids) {
      place(kid, cursor);
      childXs.push(placed.get(kid)!.x);
      cursor += spanOf(kid) + gap;
    }
    let x: number;
    if (childXs.length === 0) {
      x =
        direction === "left"
          ? left + width - nodeWidth
          : direction === "right"
            ? left
            : left + (width - nodeWidth) / 2;
    } else if (direction === "left") {
      x = childXs[childXs.length - 1]!; // above its innermost (right-most) report
    } else if (direction === "right") {
      x = childXs[0]!; // above its innermost (left-most) report
    } else {
      x = (childXs[0]! + childXs[childXs.length - 1]!) / 2;
    }
    placed.set(id, { x, y: yOf(id) });
  };

  let cursor = 0;
  for (const root of roots) {
    place(root, cursor);
    cursor += spanOf(root) + gap;
  }
  return { placed, width: Math.max(0, cursor - gap) };
}

/**
 * Re-places every department branch to grow outward, packing branches left
 * to right in their existing order with `branchGap` between them. Only the
 * given clusters' cards move; everything else keeps its position.
 */
export function arrangeBranchesOutward(
  positions: ReadonlyMap<string, Point>,
  clusters: readonly (readonly string[])[],
  edges: readonly Edge[],
  nodeWidth: number,
  gap: number,
  branchGap: number
): Map<string, Point> {
  const out = new Map(positions);
  const ordered = clusters
    .filter((members) => members.length > 0)
    .map((members) => ({
      members,
      minX: Math.min(...members.map((id) => positions.get(id)?.x ?? 0)),
    }))
    .sort((a, b) => a.minX - b.minX);
  if (ordered.length === 0) return out;

  let cursor = ordered[0]!.minX;
  ordered.forEach(({ members }, index) => {
    const direction = growDirectionFor(index, ordered.length);
    const { placed, width } = layoutBranch(members, positions, edges, direction, nodeWidth, gap);
    for (const [id, p] of placed) out.set(id, { x: cursor + p.x, y: p.y });
    cursor += width + branchGap;
  });
  return out;
}
