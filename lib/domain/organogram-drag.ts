/**
 * Arrange-mode drag-and-drop rules for the organogram (docs/DECISIONS.md
 * D21, extended by D29). Pure, so the canvas and its tests share one
 * definition of what a valid drop is. The server re-checks every move
 * (cycle rules, permissions) regardless — this only stops an obviously
 * invalid drop before a confirmation dialog is ever shown.
 */
export interface DragEdge {
  sourcePositionId: string;
  targetPositionId: string;
}

export interface DropTargetNode {
  positionId: string;
  kind?: "position" | "department" | "subdivision";
  departmentId: string;
  title: string;
  departmentName: string;
}

export type DropVerdict =
  | { valid: true; kind: "position"; targetPositionId: string; label: string }
  | { valid: true; kind: "department"; departmentId: string; label: string }
  | { valid: false; reason: string };

/**
 * Everything drawn below `positionId` on the chart (both head lines count),
 * so a drop onto any of them can be refused up front.
 */
export function collectDisplayedDescendants(
  positionId: string,
  edges: readonly DragEdge[]
): Set<string> {
  const children = new Map<string, string[]>();
  for (const e of edges) {
    const list = children.get(e.sourcePositionId) ?? [];
    list.push(e.targetPositionId);
    children.set(e.sourcePositionId, list);
  }
  const seen = new Set<string>();
  const stack = [...(children.get(positionId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const child of children.get(id) ?? []) stack.push(child);
  }
  return seen;
}

/**
 * What dropping `draggedId` onto `target` would do. Valid targets are a real
 * position (becomes the new head) or a department heading (joins that
 * department under its top position). A sub-division heading is a visual
 * grouping only and is never a target. Dropping onto itself or anything
 * below it is refused.
 */
export function judgeDrop(
  draggedId: string,
  target: DropTargetNode,
  descendantIds: ReadonlySet<string>
): DropVerdict {
  const kind = target.kind ?? "position";
  if (kind === "subdivision") {
    return {
      valid: false,
      reason:
        "A sub-division box is only a grouping — drop onto a position or a department instead.",
    };
  }
  if (kind === "department") {
    return {
      valid: true,
      kind: "department",
      departmentId: target.departmentId,
      label: target.departmentName,
    };
  }
  if (target.positionId === draggedId) {
    return { valid: false, reason: "A position can't be moved under itself." };
  }
  if (descendantIds.has(target.positionId)) {
    return {
      valid: false,
      reason: `${target.title} reports (directly or indirectly) to this position, so it can't become its head.`,
    };
  }
  return {
    valid: true,
    kind: "position",
    targetPositionId: target.positionId,
    label: target.title,
  };
}

/**
 * Where the pointer is, in screen (client) coordinates, for a mouse or touch
 * drag event — or null when the event carries no position.
 */
export function pointerClientPoint(event: unknown): { x: number; y: number } | null {
  if (!event || typeof event !== "object") return null;
  const e = event as {
    clientX?: unknown;
    clientY?: unknown;
    changedTouches?: ArrayLike<{ clientX: number; clientY: number }>;
    touches?: ArrayLike<{ clientX: number; clientY: number }>;
  };
  if (typeof e.clientX === "number" && typeof e.clientY === "number") {
    return { x: e.clientX, y: e.clientY };
  }
  const touch = e.changedTouches?.[0] ?? e.touches?.[0];
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
}

export interface DropRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The drop target is the card or department heading UNDER THE POINTER
 * (user request, 2026-09-29) — not whichever card the dragged one overlaps
 * most, which on a zoomed-out chart made small targets hard to hit. The
 * dragged card itself is always under the pointer, so it is skipped; if
 * boxes overlap, the smallest (most specific) one wins. Null = empty canvas.
 */
export function pickDropTargetAtPoint(
  point: { x: number; y: number },
  rects: readonly DropRect[],
  draggedId: string
): string | null {
  let best: DropRect | null = null;
  for (const r of rects) {
    if (r.id === draggedId) continue;
    const inside =
      point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y && point.y <= r.y + r.height;
    if (inside && (!best || r.width * r.height < best.width * best.height)) best = r;
  }
  return best?.id ?? null;
}

/**
 * Where every card of a dragged branch should be drawn mid-drag: each one's
 * position when the drag started, shifted by how far the dragged card has
 * moved — so the whole branch travels with the card under the pointer
 * (user request, 2026-10-01) instead of the card leaving its reports behind.
 */
export function moveBranch(
  startPositions: ReadonlyMap<string, { x: number; y: number }>,
  delta: { x: number; y: number }
): Map<string, { x: number; y: number }> {
  const moved = new Map<string, { x: number; y: number }>();
  for (const [id, p] of startPositions) moved.set(id, { x: p.x + delta.x, y: p.y + delta.y });
  return moved;
}
