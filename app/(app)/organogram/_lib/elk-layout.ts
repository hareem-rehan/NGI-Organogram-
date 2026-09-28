import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";

/**
 * Fixed node footprint for layout purposes only — never persisted, never
 * derived from real content measurement. ELK needs a size per node to
 * compute non-overlapping positions; the actual rendered
 * PositionNode uses the same width via Tailwind so the two stay in sync.
 */
export const NODE_WIDTH = 188;
/**
 * Must be tall enough to fit PositionNode's fixed layout (compact cards,
 * docs/DECISIONS.md D30): a bold title of up to two lines, the person, and
 * one footer row with "N roles under" and the level. The node component sets this exact
 * height + overflow-hidden on its own root element (single source of
 * truth), so ELK's spacing assumption and the actual rendered box never
 * drift apart.
 *
 * Do not shrink this without re-checking the rendered card: a prior
 * height/content mismatch caused adjacent rows to visually overlap, which
 * made e2e/organogram.spec.ts's expand-toggle clicks land on the wrong
 * element (a neighbouring node's pane area intercepted the click). The
 * value below leaves headroom over the content (a two-line title is the
 * tallest case) for exactly that reason.
 */
export const NODE_HEIGHT = 88;

export interface LayoutPosition {
  x: number;
  y: number;
}

const elk = new ELK();

/**
 * Horizontal breathing room on EACH side of a department's branch, so two
 * neighbouring departments are separated by 2 × this plus the normal node
 * spacing — clearly wider than the gap between two cards of the same
 * department, which is what makes the segregation readable.
 */
export const DEPARTMENT_SIDE_PADDING = 40;

/**
 * Vertical gap between one row of cards and the next — tight, like the
 * reference org chart, where chains of roles stack closely (D31).
 */
export const LAYER_GAP = 36;

/**
 * Where a parent's shared horizontal connector bar sits: halfway down the
 * gap to the next row. Used by the on-screen connector (org-chart-edge.tsx)
 * and the PDF/PNG export, so both draw the same shape.
 */
export const ORG_EDGE_BUS_OFFSET = LAYER_GAP / 2;

const BASE_LAYOUT_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "DOWN",
  // Compact spacing (medium cards, 2026-09-28) so more of the chart fits on
  // screen at a readable zoom.
  "elk.layered.spacing.nodeNodeBetweenLayers": String(LAYER_GAP),
  "elk.spacing.nodeNode": "24",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  // Keep siblings (and so departments) in the caller's order, left to right,
  // so the chart doesn't reshuffle between renders.
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
} as const;

/**
 * Runs ELK's layered algorithm (direction DOWN — root at top, levels
 * expanding downward, siblings arranged horizontally) entirely
 * client-side. Callers pass only the currently VISIBLE subgraph (not the
 * full up-to-2000-position graph) so a collapse genuinely reduces layout
 * cost (docs/ORGANOGRAM_RENDERING.md "Performance Strategy") — there is
 * no x/y column anywhere in the schema, so this never runs server-side
 * and its output is never stored.
 *
 * `clusterOf` (lib/domain/organogram-layout-clusters.ts) segregates the
 * chart by department: every node mapped to the same cluster is laid out
 * inside one box, and boxes sit side by side, so a wide branch can never
 * spread under a neighbouring department. Edges still connect across boxes
 * (root → department, and any cross-department reporting line). Returned
 * positions are always ABSOLUTE, with or without clusters.
 */
export async function computeElkLayout(
  nodeIds: readonly string[],
  edges: readonly { sourcePositionId: string; targetPositionId: string }[],
  clusterOf?: ReadonlyMap<string, string>
): Promise<Map<string, LayoutPosition>> {
  if (nodeIds.length === 0) return new Map();

  const leaf = (id: string): ElkNode => ({ id, width: NODE_WIDTH, height: NODE_HEIGHT });
  const elkEdges = edges.map((e, index) => ({
    id: `edge-${index}-${e.sourcePositionId}-${e.targetPositionId}`,
    sources: [e.sourcePositionId],
    targets: [e.targetPositionId],
  }));

  // Group nodes into one compound box per cluster, in first-seen order so the
  // departments keep the caller's left-to-right order.
  const clusterIds: string[] = [];
  const membersByCluster = new Map<string, string[]>();
  const looseIds: string[] = [];
  for (const id of nodeIds) {
    const cluster = clusterOf?.get(id);
    if (!cluster) {
      looseIds.push(id);
      continue;
    }
    if (!membersByCluster.has(cluster)) {
      membersByCluster.set(cluster, []);
      clusterIds.push(cluster);
    }
    membersByCluster.get(cluster)!.push(id);
  }

  const clustered = clusterIds.length > 0;
  const graph: ElkNode = {
    id: "root",
    layoutOptions: clustered
      ? { ...BASE_LAYOUT_OPTIONS, "elk.hierarchyHandling": "INCLUDE_CHILDREN" }
      : { ...BASE_LAYOUT_OPTIONS },
    children: [
      ...looseIds.map(leaf),
      ...clusterIds.map((cluster): ElkNode => ({
        id: `cluster:${cluster}`,
        layoutOptions: {
          "elk.padding": `[top=0,left=${DEPARTMENT_SIDE_PADDING},bottom=0,right=${DEPARTMENT_SIDE_PADDING}]`,
        },
        children: membersByCluster.get(cluster)!.map(leaf),
      })),
    ],
    edges: elkEdges,
  };

  const result = await elk.layout(graph);
  const positions = new Map<string, LayoutPosition>();
  for (const child of result.children ?? []) {
    if (child.id.startsWith("cluster:")) {
      const ox = child.x ?? 0;
      const oy = child.y ?? 0;
      for (const member of child.children ?? []) {
        positions.set(member.id, { x: ox + (member.x ?? 0), y: oy + (member.y ?? 0) });
      }
    } else {
      positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
    }
  }

  // With clusters, ELK places a loose card (the root) next to whichever
  // department its edges pull it toward. Centre each loose card over its own
  // direct reports instead, like the reference chart's CEO over the whole row
  // of departments. Loose cards sit on rows of their own, so this never
  // creates an overlap.
  if (clustered) {
    for (const id of looseIds) {
      const childXs = edges
        .filter((e) => e.sourcePositionId === id)
        .map((e) => positions.get(e.targetPositionId)?.x)
        .filter((x): x is number => x !== undefined);
      const own = positions.get(id);
      if (!own || childXs.length === 0) continue;
      const centre = (Math.min(...childXs) + Math.max(...childXs) + NODE_WIDTH) / 2;
      positions.set(id, { x: centre - NODE_WIDTH / 2, y: own.y });
    }
  }
  return positions;
}
