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
