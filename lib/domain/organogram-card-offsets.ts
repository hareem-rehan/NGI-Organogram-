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
