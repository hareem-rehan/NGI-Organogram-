import type { OrganogramEdge, OrganogramNode } from "@/lib/domain/organogram";
import {
  buildLeadershipView,
  DEFAULT_LEADERSHIP_VIEW_OPTIONS,
  type LeadershipViewOptions,
} from "@/lib/domain/organogram-leadership";

/**
 * Turns `buildLeadershipView`'s abstract answer ("who is visible, and who
 * is whose display parent") into a concrete node/edge graph in exactly
 * the shape the rest of the app already renders.
 *
 * Doing the reshape at the GRAPH level, rather than teaching each view
 * about departments, is what keeps this a refinement instead of a
 * rewrite: the canvas, the outline view, collapse/expand, search, the
 * focus modes, the filters and the export renderer all keep consuming
 * `OrganogramNode[]` + `OrganogramEdge[]` and need no idea that a
 * department tier now exists. Only the two places that DRAW a card
 * (position-node.tsx and the SVG renderer) look at `kind`.
 *
 * Nothing here writes to the database or changes a single stored value.
 * A hidden position still exists, still appears in the Positions list,
 * in search on that page, in the dashboard counts and in the audit log.
 */

/** Tells the UI what was left out, so "fewer boxes than I expected" reads as a filter rather than as missing data. */
export interface LeadershipSummary {
  /** False when the caller asked for the unfiltered graph. */
  applied: boolean;
  /** The grade threshold in force, e.g. 7 for "L7 and above". */
  minGradeLevel: number;
  departmentGroupCount: number;
  shownPositionCount: number;
  hidden: {
    vacant: number;
    ungraded: number;
    belowGrade: number;
    total: number;
  };
}

export interface LeadershipGraph {
  nodes: OrganogramNode[];
  edges: OrganogramEdge[];
  summary: LeadershipSummary;
}

/**
 * A synthetic department card. Several `OrganogramNode` fields have no
 * meaning for a department heading and are filled with deliberately inert
 * values rather than invented ones:
 *
 * - `organizationalLevel: 0` — real levels start at 1, so 0 is outside
 *   the scale by construction and can never be mistaken for one. This is
 *   the type-level expression of CLAUDE.md §2's rule that a department
 *   heading is not an organizational level.
 * - `occupancyStatus: "occupied"` — a department is not a seat, so it is
 *   not vacant either. Marking it occupied keeps it out of every vacancy
 *   count and vacancy filter, which is the honest answer; the card itself
 *   never renders an occupancy state, because it renders by `kind`.
 * - `positionStatus: "ACTIVE"` — likewise keeps it out of the
 *   planned/inactive treatments it has no business appearing in.
 */
function makeDepartmentNode(args: {
  groupId: string;
  departmentId: string;
  name: string;
  code: string;
  color: string | null;
  parentId: string | null;
}): OrganogramNode {
  return {
    kind: "department",
    positionId: args.groupId,
    positionCode: args.code,
    title: args.name,
    departmentId: args.departmentId,
    departmentName: args.name,
    departmentCode: args.code,
    departmentColor: args.color,
    jobGradeId: null,
    jobGradeName: null,
    jobGradeCode: null,
    jobGradeLevel: null,
    organizationalLevel: 0,
    positionStatus: "ACTIVE",
    occupancyStatus: "occupied",
    occupantDisplayName: null,
    occupantEmployeeId: null,
    directReportCount: 0,
    primaryReportsToPositionId: args.parentId,
    hasChildren: false,
    isPlanned: false,
    isActive: true,
  };
}

/**
 * Projects the full organogram graph into the leadership view.
 *
 * The input `edges` are not consumed: every displayed edge is regenerated
 * from the view's display-parent map, because that map is the only thing
 * that knows a CTO now hangs off "Engineering" rather than off the CEO.
 * Regenerating (rather than filtering the originals) is also what
 * guarantees no dangling edge survives — an edge exists here only if both
 * of its endpoints are in `nodes`.
 */
export function projectLeadershipGraph(
  nodes: readonly OrganogramNode[],
  options: LeadershipViewOptions = DEFAULT_LEADERSHIP_VIEW_OPTIONS
): LeadershipGraph {
  const view = buildLeadershipView(nodes, options);

  // Department code/colour come from the real Department rows already
  // denormalized onto every member node, so the heading matches what the
  // Departments page shows instead of being reconstructed from the name.
  const departmentMeta = new Map<string, { code: string; color: string | null }>();
  for (const node of nodes) {
    if (!departmentMeta.has(node.departmentId)) {
      departmentMeta.set(node.departmentId, {
        code: node.departmentCode,
        color: node.departmentColor,
      });
    }
  }

  const positionNodes: OrganogramNode[] = nodes
    .filter((node) => view.visiblePositionIds.has(node.positionId))
    .map((node) => ({
      ...node,
      kind: "position" as const,
      primaryReportsToPositionId:
        node.positionId === view.rootPositionId
          ? null
          : (view.parentByPositionId.get(node.positionId) ?? null),
    }));

  const departmentNodes: OrganogramNode[] = view.departmentGroups.map((group) =>
    makeDepartmentNode({
      groupId: group.id,
      departmentId: group.departmentId,
      name: group.name,
      code: departmentMeta.get(group.departmentId)?.code ?? "—",
      color: group.color ?? departmentMeta.get(group.departmentId)?.color ?? null,
      parentId: view.rootPositionId,
    })
  );

  const allNodes = [...positionNodes, ...departmentNodes];

  const childrenByParent = new Map<string, string[]>();
  for (const node of allNodes) {
    if (node.primaryReportsToPositionId === null) continue;
    const list = childrenByParent.get(node.primaryReportsToPositionId) ?? [];
    list.push(node.positionId);
    childrenByParent.set(node.primaryReportsToPositionId, list);
  }

  // Breadth-first from every display root. Iterative and bounded, for the
  // same reason computeVisiblePositionIds is: the input is already
  // cycle-free, and this must stay that way even if a future caller
  // hands it something that isn't.
  const depthById = new Map<string, number>();
  const queue: { id: string; depth: number }[] = allNodes
    .filter((node) => node.primaryReportsToPositionId === null)
    .map((node) => ({ id: node.positionId, depth: 1 }));
  let guard = allNodes.length * 2 + 10;
  while (queue.length > 0 && guard-- > 0) {
    const current = queue.shift()!;
    if (depthById.has(current.id)) continue;
    depthById.set(current.id, current.depth);
    for (const childId of childrenByParent.get(current.id) ?? []) {
      queue.push({ id: childId, depth: current.depth + 1 });
    }
  }

  const projectedNodes = allNodes
    .map((node): OrganogramNode => {
      const displayChildCount = childrenByParent.get(node.positionId)?.length ?? 0;
      return {
        ...node,
        displayDepth: depthById.get(node.positionId) ?? 1,
        displayChildCount,
        hasChildren: displayChildCount > 0,
      };
    })
    // Same deterministic ordering contract as buildOrganogramGraph, with
    // the display tier in place of the organizational level (a department
    // node has no organizational level to sort by).
    .sort(
      (a, b) =>
        (a.displayDepth ?? 0) - (b.displayDepth ?? 0) ||
        a.title.localeCompare(b.title) ||
        a.positionCode.localeCompare(b.positionCode)
    );

  const edges: OrganogramEdge[] = projectedNodes
    .filter((node) => node.primaryReportsToPositionId !== null)
    .map((node) => ({
      sourcePositionId: node.primaryReportsToPositionId!,
      targetPositionId: node.positionId,
      reportingType: "PRIMARY" as const,
    }))
    .sort(
      (a, b) =>
        a.sourcePositionId.localeCompare(b.sourcePositionId) ||
        a.targetPositionId.localeCompare(b.targetPositionId)
    );

  return {
    nodes: projectedNodes,
    edges,
    summary: {
      applied: true,
      minGradeLevel: options.minGradeLevel,
      departmentGroupCount: departmentNodes.length,
      shownPositionCount: positionNodes.length,
      hidden: {
        vacant: view.excluded.vacant,
        ungraded: view.excluded.ungraded,
        belowGrade: view.excluded.belowGrade,
        total: view.excluded.vacant + view.excluded.ungraded + view.excluded.belowGrade,
      },
    },
  };
}
