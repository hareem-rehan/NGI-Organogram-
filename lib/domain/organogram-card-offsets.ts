/**
 * HR-placed organogram cards (docs/DECISIONS.md D38). The chart is still laid
 * out automatically; a card HR has dragged onto empty canvas keeps an OFFSET
 * from its automatic position, so it stays where it was put while the chart
 * around it can still change. Pure: no DB, no React.
 */

export interface CardOffset {
  dx: number;
  dy: number;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * A chart node id that can carry an offset: a position id, a department box
 * (`dept:<departmentId>`) or a sub-division box
 * (`subdiv:<leadPositionId>:<jobFamilyId>`).
 */
export const CARD_NODE_KEY_PATTERN = new RegExp(
  `^(?:${UUID}|dept:${UUID}|subdiv:${UUID}:${UUID})$`,
  "i"
);

export type ParsedNodeKey =
  | { kind: "position"; positionId: string }
  | { kind: "department"; departmentId: string }
  | { kind: "subdivision"; leadPositionId: string; jobFamilyId: string };

export function parseCardNodeKey(nodeKey: string): ParsedNodeKey | null {
  if (!CARD_NODE_KEY_PATTERN.test(nodeKey)) return null;
  if (nodeKey.startsWith("dept:")) return { kind: "department", departmentId: nodeKey.slice(5) };
  if (nodeKey.startsWith("subdiv:")) {
    const [leadPositionId, jobFamilyId] = nodeKey.slice(7).split(":");
    return { kind: "subdivision", leadPositionId: leadPositionId!, jobFamilyId: jobFamilyId! };
  }
  return { kind: "position", positionId: nodeKey };
}

/**
 * Department, sub-department and sub-division boxes are never hand-placed
 * (D55): dragging one reorders it among its siblings, its whole branch
 * moving with it. Offsets saved for them before D55 are ignored.
 */
export function isGroupingNodeKey(nodeKey: string): boolean {
  const parsed = parseCardNodeKey(nodeKey);
  return parsed !== null && parsed.kind !== "position";
}

/** Automatic positions with each saved offset added; cards without one are unchanged. */
export function applyCardOffsets<P extends { x: number; y: number }>(
  positions: ReadonlyMap<string, P>,
  offsets: Readonly<Record<string, CardOffset>>
): Map<string, { x: number; y: number }> {
  const placed = new Map<string, { x: number; y: number }>();
  for (const [id, p] of positions) {
    const o = offsets[id];
    placed.set(id, o ? { x: p.x + o.dx, y: p.y + o.dy } : { x: p.x, y: p.y });
  }
  return placed;
}

/**
 * A department box dropped onto a sibling department box takes that box's
 * place in the left-to-right order; the others keep their relative order.
 * Returns the order unchanged if either id is not in the row.
 */
export function departmentOrderAfterDrop(
  orderedIds: readonly string[],
  draggedId: string,
  targetId: string
): string[] {
  const from = orderedIds.indexOf(draggedId);
  const to = orderedIds.indexOf(targetId);
  if (from === -1 || to === -1 || from === to) return [...orderedIds];
  const next = orderedIds.filter((id) => id !== draggedId);
  next.splice(to, 0, draggedId);
  return next;
}

/**
 * A grouping box (department, sub-department or sub-division) let go anywhere
 * in its row takes the slot its centre landed in (D55): it goes before the
 * first sibling whose centre is to the right of the drop, else last. The
 * siblings are given left to right by their current centre x. Returns ids in
 * the new order; unchanged if the dragged id is not in the row.
 */
export function orderAfterDropAt(
  row: readonly { id: string; centerX: number }[],
  draggedId: string,
  dropCenterX: number
): string[] {
  const ids = row.map((r) => r.id);
  if (!ids.includes(draggedId)) return ids;
  const others = row.filter((r) => r.id !== draggedId);
  const index = others.findIndex((r) => r.centerX > dropCenterX);
  const next = others.map((r) => r.id);
  next.splice(index === -1 ? next.length : index, 0, draggedId);
  return next;
}

/**
 * Re-sorts some members of a longer list without disturbing the rest (D55):
 * the reordered ids take over exactly the slots they held, in their new
 * order. Used for sub-divisions, whose saved order is company-wide while a
 * drag only reorders the boxes under one position. Ids in `reordered` that
 * are not in `full` are ignored.
 */
export function reorderWithinSlots(
  full: readonly string[],
  reordered: readonly string[]
): string[] {
  const inFull = new Set(full);
  const queue = reordered.filter((id) => inFull.has(id));
  const moving = new Set(queue);
  return full.map((id) => (moving.has(id) ? queue.shift()! : id));
}

/**
 * Cards never overlap (user request, 2026-10-02). A hand-placed card keeps an
 * offset from its automatic spot, so when the automatic layout changes (a
 * branch is collapsed or expanded, a card is added) it can land on another
 * card. Each placed card that overlaps another is nudged sideways to the
 * nearer free spot beside it — and, if that keeps colliding, down a row.
 * Cards without an offset never move (the automatic layout has no overlaps).
 */
/** One size for every card, or each card's own size (content-sized cards, D47). */
export type CardSizeSource =
  { width: number; height: number } | ((id: string) => { width: number; height: number });

export function resolveOverlaps(
  positions: ReadonlyMap<string, { x: number; y: number }>,
  movableIds: readonly string[],
  size: CardSizeSource,
  gap: number
): Map<string, { x: number; y: number }> {
  const out = new Map(positions);
  const sizeOf = typeof size === "function" ? size : () => size;
  const overlaps = (
    aId: string,
    a: { x: number; y: number },
    bId: string,
    b: { x: number; y: number }
  ) => {
    const sa = sizeOf(aId);
    const sb = sizeOf(bId);
    return (
      a.x < b.x + sb.width + gap / 2 &&
      b.x < a.x + sa.width + gap / 2 &&
      a.y < b.y + sb.height + gap / 2 &&
      b.y < a.y + sa.height + gap / 2
    );
  };
  const blocker = (id: string, p: { x: number; y: number }) => {
    for (const [other, q] of out)
      if (other !== id && overlaps(id, p, other, q)) return { id: other, p: q };
    return null;
  };

  for (const id of movableIds) {
    let p = out.get(id);
    if (!p) continue;
    for (let attempt = 0; attempt < 60; attempt++) {
      const found = blocker(id, p);
      if (!found) break;
      const hit = found.p;
      if (attempt < 30) {
        const left = hit.x - sizeOf(id).width - gap;
        const right = hit.x + sizeOf(found.id).width + gap;
        p = { x: Math.abs(left - p.x) <= Math.abs(right - p.x) ? left : right, y: p.y };
      } else {
        p = { x: p.x, y: hit.y + sizeOf(found.id).height + gap };
      }
    }
    out.set(id, p);
  }
  return out;
}

/**
 * Like resolveOverlaps, but cards moved together — the same saved shift, i.e.
 * one branch moved as a whole (D62) — step aside as ONE rigid group, so the
 * branch keeps its shape instead of single cards being pushed out of it.
 */
export function resolveGroupOverlaps(
  positions: ReadonlyMap<string, { x: number; y: number }>,
  groups: readonly (readonly string[])[],
  size: CardSizeSource,
  gap: number
): Map<string, { x: number; y: number }> {
  const out = new Map(positions);
  const sizeOf = typeof size === "function" ? size : () => size;
  const overlaps = (
    aId: string,
    a: { x: number; y: number },
    bId: string,
    b: { x: number; y: number }
  ) => {
    const sa = sizeOf(aId);
    const sb = sizeOf(bId);
    return (
      a.x < b.x + sb.width + gap / 2 &&
      b.x < a.x + sa.width + gap / 2 &&
      a.y < b.y + sb.height + gap / 2 &&
      b.y < a.y + sa.height + gap / 2
    );
  };

  for (const group of groups) {
    const members = group.filter((id) => out.has(id));
    if (members.length === 0) continue;
    const inGroup = new Set(members);
    let shift = { x: 0, y: 0 };
    const at = (id: string) => {
      const p = out.get(id)!;
      return { x: p.x + shift.x, y: p.y + shift.y };
    };
    for (let attempt = 0; attempt < 60; attempt++) {
      let hit: { member: string; other: string; q: { x: number; y: number } } | null = null;
      for (const member of members) {
        const p = at(member);
        for (const [other, q] of out) {
          if (inGroup.has(other) || !overlaps(member, p, other, q)) continue;
          hit = { member, other, q };
          break;
        }
        if (hit) break;
      }
      if (!hit) break;
      const p = at(hit.member);
      if (attempt < 30) {
        const left = hit.q.x - sizeOf(hit.member).width - gap - p.x;
        const right = hit.q.x + sizeOf(hit.other).width + gap - p.x;
        shift = { x: shift.x + (Math.abs(left) <= Math.abs(right) ? left : right), y: shift.y };
      } else {
        shift = { x: shift.x, y: shift.y + (hit.q.y + sizeOf(hit.other).height + gap - p.y) };
      }
    }
    for (const member of members) out.set(member, at(member));
  }
  return out;
}

/** Automatic positions + saved offsets, with no two cards overlapping. */
export function placeCards(
  positions: ReadonlyMap<string, { x: number; y: number }>,
  offsets: Readonly<Record<string, CardOffset>>,
  size: CardSizeSource,
  gap: number
): Map<string, { x: number; y: number }> {
  const placed = applyCardOffsets(positions, offsets);
  // Cards sharing a shift were moved together (one branch, D62).
  const groups = new Map<string, string[]>();
  for (const id of positions.keys()) {
    const offset = offsets[id];
    if (!offset) continue;
    const key = `${Math.round(offset.dx)},${Math.round(offset.dy)}`;
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  return resolveGroupOverlaps(placed, [...groups.values()], size, gap);
}
