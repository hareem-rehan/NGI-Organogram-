import { arrangeBranchesOutward } from "./outward-layout";
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
export const DEPARTMENT_SIDE_PADDING = 56;

/**
 * Vertical gap between one row of cards and the next. Roomy enough that the
 * connector's horizontal bar sits clearly between the rows instead of
 * hugging the cards (user request, 2026-09-29; was 36 in D31).
 */
export const LAYER_GAP = 64;

/**
 * Horizontal gap between two cards side by side in the same department, so
 * neighbouring cards (and the lines dropping into them) never look cramped.
 */
export const NODE_GAP = 44;

/**
 * Where a parent's shared horizontal connector bar sits: halfway down the
 * gap to the next row. Used by the on-screen connector (org-chart-edge.tsx)
 * and the PDF/PNG export, so both draw the same shape.
 */
export const ORG_EDGE_BUS_OFFSET = LAYER_GAP / 2;

const BASE_LAYOUT_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "DOWN",
  // Spacing between rows and between side-by-side cards (see LAYER_GAP /
  // NODE_GAP above).
  "elk.layered.spacing.nodeNodeBetweenLayers": String(LAYER_GAP),
  "elk.spacing.nodeNode": String(NODE_GAP),
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  // Keep siblings (and so departments) in the caller's order, left to right,
  // so the chart doesn't reshuffle between renders.
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  // Strict, not a hint: departments appear left to right in exactly their
  // saved order (D33), so what a manager drags is what stays on screen.
  "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
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
  clusterOf?: ReadonlyMap<string, string>,
  /** Each card's own size (content-sized cards, D47); the standard size otherwise. */
  sizeOf?: (id: string) => { width: number; height: number }
): Promise<Map<string, LayoutPosition>> {
  if (nodeIds.length === 0) return new Map();

  const size = sizeOf ?? (() => ({ width: NODE_WIDTH, height: NODE_HEIGHT }));
  const widthOf = (id: string) => size(id).width;
  const leaf = (id: string): ElkNode => ({ id, ...size(id) });
  // ELK weighs EDGE order as well as node order ("NODES_AND_EDGES"), and the
  // callers' edges are sorted by id, which is effectively random for
  // department / sub-department boxes. Put the edges in the same order as the
  // nodes they point to, so the node order (the saved left-to-right order,
  // D33) is the only thing that decides placement.
  const rank = new Map(nodeIds.map((id, index) => [id, index]));
  const rankOf = (id: string) => rank.get(id) ?? Number.MAX_SAFE_INTEGER;
  const orderedEdges = [...edges].sort(
    (x, y) =>
      rankOf(x.targetPositionId) - rankOf(y.targetPositionId) ||
      rankOf(x.sourcePositionId) - rankOf(y.sourcePositionId)
  );
  const elkEdges = orderedEdges.map((e, index) => ({
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
          // Spacing is read per box: without these, the rows and cards INSIDE
          // a department fall back to ELK's cramped 20px defaults.
          "elk.layered.spacing.nodeNodeBetweenLayers": String(LAYER_GAP),
          "elk.spacing.nodeNode": String(NODE_GAP),
        },
        children: membersByCluster.get(cluster)!.map(leaf),
      })),
    ],
    edges: elkEdges,
  };

  const result = await elk.layout(graph);
  let positions = new Map<string, LayoutPosition>();
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

  // Department branches grow AWAY from the centre: left-half departments to
  // the left, right-half ones to the right (outward-layout.ts). Rows and
  // department order are ELK's; only horizontal placement changes.
  if (clustered) {
    positions = arrangeBranchesOutward(
      positions,
      clusterIds.map((cluster) => membersByCluster.get(cluster)!),
      edges,
      widthOf,
      NODE_GAP,
      2 * DEPARTMENT_SIDE_PADDING + NODE_GAP
    );
  }

  // With clusters, ELK places a loose card (the root) next to whichever
  // department its edges pull it toward. Centre each loose card over its own
  // direct reports instead, like the reference chart's CEO over the whole row
  // of departments. Loose cards sit on rows of their own, so this never
  // creates an overlap.
  if (clustered) {
    for (const id of looseIds) {
      const children = edges
        .filter((e) => e.sourcePositionId === id)
        .map((e) => e.targetPositionId)
        .filter((child) => positions.has(child));
      const own = positions.get(id);
      if (!own || children.length === 0) continue;
      const lefts = children.map((child) => positions.get(child)!.x);
      const rights = children.map((child) => positions.get(child)!.x + widthOf(child));
      const centre = (Math.min(...lefts) + Math.max(...rights)) / 2;
      positions.set(id, { x: centre - widthOf(id) / 2, y: own.y });
    }
  }
  return positions;
}
