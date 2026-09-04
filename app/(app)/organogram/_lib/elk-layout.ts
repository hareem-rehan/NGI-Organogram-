import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";

/**
 * Fixed node footprint for layout purposes only — never persisted, never
 * derived from real content measurement. ELK needs a size per node to
 * compute non-overlapping positions; the actual rendered
 * PositionNode uses the same width via Tailwind so the two stay in sync.
 */
export const NODE_WIDTH = 260;
/**
 * Must be tall enough to fit PositionNode's fixed 5-row layout (title,
 * occupant, department/level, position code, expand-toggle) — the node
 * component sets this exact height + overflow-hidden on its own root
 * element (single source of truth), so ELK's spacing assumption and the
 * actual rendered box never drift apart. A prior height/content mismatch
 * here caused adjacent rows to visually overlap, which made
 * e2e/organogram.spec.ts's expand-toggle clicks land on the wrong
 * element (a neighboring node's pane area intercepted the click).
 */
export const NODE_HEIGHT = 152;

export interface LayoutPosition {
  x: number;
  y: number;
}

const elk = new ELK();

/**
 * Runs ELK's layered algorithm (direction DOWN — root at top, levels
 * expanding downward, siblings arranged horizontally) entirely
 * client-side. Callers pass only the currently VISIBLE subgraph (not the
 * full up-to-2000-position graph) so a collapse genuinely reduces layout
 * cost (docs/ORGANOGRAM_RENDERING.md "Performance Strategy") — there is
 * no x/y column anywhere in the schema, so this never runs server-side
 * and its output is never stored.
 */
export async function computeElkLayout(
  nodeIds: readonly string[],
  edges: readonly { sourcePositionId: string; targetPositionId: string }[]
): Promise<Map<string, LayoutPosition>> {
  if (nodeIds.length === 0) return new Map();

  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.layered.spacing.nodeNodeBetweenLayers": "72",
      "elk.spacing.nodeNode": "36",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    },
    children: nodeIds.map((id) => ({ id, width: NODE_WIDTH, height: NODE_HEIGHT })),
    edges: edges.map((e, index) => ({
      id: `edge-${index}-${e.sourcePositionId}-${e.targetPositionId}`,
      sources: [e.sourcePositionId],
      targets: [e.targetPositionId],
    })),
  };

  const result = await elk.layout(graph);
  const positions = new Map<string, LayoutPosition>();
  for (const child of result.children ?? []) {
    positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  }
  return positions;
}
