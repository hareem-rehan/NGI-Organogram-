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

/** A fixed card width, or each card's own width (content-sized cards, D47). */
export type CardWidth = number | ((id: string) => number);

function widthFn(width: CardWidth): (id: string) => number {
  return typeof width === "number" ? () => width : width;
}

interface Edge {
  sourcePositionId: string;
  targetPositionId: string;
}

/**
 * Lays one department's cards out as a tree from x = 0, every manager
 * centred over its reports (D48). `_direction` is kept for callers; since
 * D48 a branch no longer leans towards one side. Returns the new positions (same y as given) and the branch width.
 */
export function layoutBranch(
  memberIds: readonly string[],
  positions: ReadonlyMap<string, Point>,
  edges: readonly Edge[],
  _direction: GrowDirection,
  nodeWidth: CardWidth,
  gap: number
): { placed: Map<string, Point>; width: number } {
  const widthOf = widthFn(nodeWidth);
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

  // Each subtree is measured once: its total width, where its own card sits
  // in that width, and where its children block starts. A manager is centred
  // over its reports (D48), so a single report hangs straight below it even
  // when the two cards differ in width; the subtree widens to fit any
  // overhang, so nothing overlaps.
  interface Measure {
    width: number;
    /** The card's own x, relative to the subtree's left edge. */
    cardX: number;
    /** Where the children block starts, relative to the subtree's left edge. */
    childrenX: number;
  }
  const measured = new Map<string, Measure>();
  const measure = (id: string, seen = new Set<string>()): Measure => {
    const cached = measured.get(id);
    if (cached) return cached;
    const own = widthOf(id);
    const kids = seen.has(id) ? [] : (children.get(id) ?? []); // defensive: never loop
    seen.add(id);
    let result: Measure;
    if (kids.length === 0) {
      result = { width: own, cardX: 0, childrenX: 0 };
    } else {
      // Children side by side from 0; note each child's card centre.
      let cursor = 0;
      const centres: number[] = [];
      for (const kid of kids) {
        const m = measure(kid, seen);
        centres.push(cursor + m.cardX + widthOf(kid) / 2);
        cursor += m.width + gap;
      }
      const childrenWidth = cursor - gap;
      // Centred over its reports (user request, D48): midway between the
      // first and last report's card centres. With one report that is
      // exactly above it, so the line between them is straight.
      const anchor = (centres[0]! + centres[centres.length - 1]!) / 2;
      const cardX = anchor - own / 2;
      const minX = Math.min(0, cardX);
      const maxX = Math.max(childrenWidth, cardX + own);
      result = { width: maxX - minX, cardX: cardX - minX, childrenX: -minX };
    }
    measured.set(id, result);
    return result;
  };

  const placed = new Map<string, Point>();
  const place = (id: string, left: number) => {
    const m = measure(id);
    placed.set(id, { x: left + m.cardX, y: yOf(id) });
    let cursor = left + m.childrenX;
    for (const kid of children.get(id) ?? []) {
      place(kid, cursor);
      cursor += measure(kid).width + gap;
    }
  };

  let cursor = 0;
  for (const root of roots) {
    place(root, cursor);
    cursor += measure(root).width + gap;
  }

  // A two-head card sits under one head in the tree above. Centre it (and the
  // chain below it) between BOTH heads instead, like the reference chart, so
  // the two lines meet symmetrically — only when nothing would overlap.
  const headsOf = (id: string) =>
    edges
      .filter((e) => e.targetPositionId === id && placed.has(e.sourcePositionId))
      .map((e) => e.sourcePositionId);
  const centreOf = (id: string) => placed.get(id)!.x + widthOf(id) / 2;
  const subtreeOf = (id: string): string[] => [
    id,
    ...(children.get(id) ?? []).flatMap((kid) => subtreeOf(kid)),
  ];
  for (const id of memberIds) {
    const heads = headsOf(id);
    if (heads.length !== 2 || !placed.has(id)) continue;
    const delta = (centreOf(heads[0]!) + centreOf(heads[1]!)) / 2 - centreOf(id);
    if (Math.abs(delta) < 0.5) continue;
    const moving = new Set(subtreeOf(id));
    const clashes = [...moving].some((m) => {
      const p = placed.get(m)!;
      const left = p.x + delta;
      const right = left + widthOf(m);
      return [...placed].some(
        ([other, q]) =>
          !moving.has(other) &&
          q.y === p.y &&
          left < q.x + widthOf(other) + gap / 2 &&
          q.x < right + gap / 2
      );
    });
    if (clashes) continue;
    for (const m of moving) placed.set(m, { x: placed.get(m)!.x + delta, y: placed.get(m)!.y });
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
  nodeWidth: CardWidth,
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
