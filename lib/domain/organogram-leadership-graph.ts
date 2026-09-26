import type { OrganogramEdge, OrganogramNode } from "@/lib/domain/organogram";
import {
  buildLeadershipView,
  DEFAULT_LEADERSHIP_VIEW_OPTIONS,
  departmentGroupId,
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
  /**
   * In the graph but folded away by default, because they are graded
   * below the threshold. Expanding their manager reveals them — they are
   * "not shown yet", not "not shown".
   */
  collapsedBelowThreshold: number;
  hidden: {
    vacant: number;
    ungraded: number;
    belowGrade: number;
    /** Deactivated positions dropped from the chart. */
    inactive: number;
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
/** Synthetic id for a sub-division grouping card, unique per (leading position, family). */
export const SUBDIVISION_GROUP_ID_PREFIX = "subdiv:";
export function subdivisionGroupId(leadPositionId: string, jobFamilyId: string): string {
  return `${SUBDIVISION_GROUP_ID_PREFIX}${leadPositionId}:${jobFamilyId}`;
}
export function isSubdivisionGroupId(id: string): boolean {
  return id.startsWith(SUBDIVISION_GROUP_ID_PREFIX);
}

/**
 * A synthetic sub-division card, inserted between a position and its reports
 * when that position's reports span 2+ sub-divisions (docs/DECISIONS.md D25).
 * Like the department heading it is pure visual grouping — inert on every
 * field that describes a real seat — but it carries `jobFamilyId`/name so the
 * card paints in its sub-division colour (matching the Visily reference) and
 * `departmentId` so department colouring/focus still resolve.
 */
function makeSubdivisionNode(args: {
  groupId: string;
  jobFamilyId: string;
  name: string;
  parentId: string;
  departmentId: string;
  departmentName: string;
  departmentCode: string;
  departmentColor: string | null;
  memberCount: number;
}): OrganogramNode {
  return {
    kind: "subdivision",
    departmentMemberCount: args.memberCount,
    positionId: args.groupId,
    positionCode: args.name,
    title: args.name,
    departmentId: args.departmentId,
    departmentName: args.departmentName,
    departmentCode: args.departmentCode,
    departmentColor: args.departmentColor,
    jobGradeId: null,
    jobGradeName: null,
    jobGradeCode: null,
    jobGradeLevel: null,
    jobFamilyId: args.jobFamilyId,
    jobFamilyName: args.name,
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

function makeDepartmentNode(args: {
  groupId: string;
  departmentId: string;
  name: string;
  code: string;
  color: string | null;
  parentId: string | null;
  memberCount: number;
}): OrganogramNode {
  return {
    kind: "department",
    departmentMemberCount: args.memberCount,
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
    jobFamilyId: null,
    jobFamilyName: null,
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
 * Groups a position's reports under synthetic sub-division cards when those
 * reports span two or more sub-divisions. Returns the nodes with the new
 * cards appended and the grouped reports re-parented onto them. Positions with
 * no sub-division, and positions whose reports all share one (or no)
 * sub-division, are left exactly as they were.
 */
function insertSubdivisionTier(baseNodes: readonly OrganogramNode[]): OrganogramNode[] {
  // Direct children of each node (in the already-parented base tree).
  const childrenByParent = new Map<string, OrganogramNode[]>();
  for (const node of baseNodes) {
    const parentId = node.primaryReportsToPositionId;
    if (parentId === null) continue;
    const list = childrenByParent.get(parentId) ?? [];
    list.push(node);
    childrenByParent.set(parentId, list);
  }

  const subdivisionNodes: OrganogramNode[] = [];
  const reParentTo = new Map<string, string>(); // childPositionId -> subdivision group id

  for (const parent of baseNodes) {
    // Group only under REAL positions (a department heading's children stay
    // as positions; a sub-division never nests under another grouping card).
    if ((parent.kind ?? "position") !== "position") continue;

    const positionChildren = (childrenByParent.get(parent.positionId) ?? []).filter(
      (c) => (c.kind ?? "position") === "position"
    );

    // Bucket the reports by sub-division; family-less reports are not bucketed.
    const byFamily = new Map<string, { name: string; children: OrganogramNode[] }>();
    for (const child of positionChildren) {
      if (!child.jobFamilyId) continue;
      const bucket = byFamily.get(child.jobFamilyId) ?? {
        name: child.jobFamilyName ?? "Sub-division",
        children: [],
      };
      bucket.children.push(child);
      byFamily.set(child.jobFamilyId, bucket);
    }

    // The rule: only when the reports span 2+ distinct sub-divisions.
    if (byFamily.size < 2) continue;

    // Deterministic order: by sub-division name, then id.
    const familyEntries = [...byFamily.entries()].sort(
      (a, b) => a[1].name.localeCompare(b[1].name) || a[0].localeCompare(b[0])
    );
    for (const [familyId, bucket] of familyEntries) {
      const groupId = subdivisionGroupId(parent.positionId, familyId);
      subdivisionNodes.push(
        makeSubdivisionNode({
          groupId,
          jobFamilyId: familyId,
          name: bucket.name,
          parentId: parent.positionId,
          departmentId: parent.departmentId,
          departmentName: parent.departmentName,
          departmentCode: parent.departmentCode,
          departmentColor: parent.departmentColor,
          memberCount: bucket.children.length,
        })
      );
      for (const child of bucket.children) reParentTo.set(child.positionId, groupId);
    }
  }

  if (subdivisionNodes.length === 0) return [...baseNodes];

  const reParented = baseNodes.map((node) =>
    reParentTo.has(node.positionId)
      ? { ...node, primaryReportsToPositionId: reParentTo.get(node.positionId)! }
      : node
  );
  return [...reParented, ...subdivisionNodes];
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
  options: LeadershipViewOptions = DEFAULT_LEADERSHIP_VIEW_OPTIONS,
  /** Active departments, so ones with no position yet still appear as empty headings. `parentDepartmentId` nests a sub-department's box under its parent department's box. */
  allDepartments: readonly {
    id: string;
    name: string;
    code: string;
    color: string | null;
    parentDepartmentId?: string | null;
  }[] = []
): LeadershipGraph {
  const view = buildLeadershipView(nodes, options, allDepartments);

  // Department parent chain, so a sub-department (Product under Client
  // Delivery Services) hangs under its parent department's box instead of
  // flat under the root. Only departments that actually have a box on the
  // chart can be a display parent; a sub-department whose parent is absent
  // (archived, or filtered out) climbs to the nearest ancestor that does
  // have a box, and otherwise falls back to the root — so it is never
  // orphaned. The walk is cycle-guarded (a department parent cycle would
  // otherwise loop forever).
  const parentDeptById = new Map<string, string | null>();
  for (const dept of allDepartments) parentDeptById.set(dept.id, dept.parentDepartmentId ?? null);
  const groupDeptIds = new Set(view.departmentGroups.map((g) => g.departmentId));
  function resolveDepartmentParentId(departmentId: string): string | null {
    const seen = new Set<string>([departmentId]);
    let current = parentDeptById.get(departmentId) ?? null;
    while (current) {
      if (seen.has(current)) break; // defensive: department parent cycle
      seen.add(current);
      if (groupDeptIds.has(current)) return departmentGroupId(current);
      current = parentDeptById.get(current) ?? null;
    }
    return view.rootPositionId;
  }

  // Department code/colour come from the real Department rows already
  // denormalized onto every member node, so the heading matches what the
  // Departments page shows instead of being reconstructed from the name.
  // Seeded from `allDepartments` first, so an EMPTY department (which has
  // no member node to read from) still gets its real code and colour.
  const departmentMeta = new Map<string, { code: string; color: string | null }>();
  for (const dept of allDepartments) {
    departmentMeta.set(dept.id, { code: dept.code, color: dept.color });
  }
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
      parentId: resolveDepartmentParentId(group.departmentId),
      memberCount: group.memberCount,
    })
  );

  const baseNodes = [...positionNodes, ...departmentNodes];

  // Insert the sub-division tier: under any position whose reports fall into
  // 2+ distinct sub-divisions, group each sub-division's reports beneath a
  // synthetic card (docs/DECISIONS.md D25). Reports with no sub-division stay
  // directly under the position. One sub-division (or none) → no card, so the
  // tier never appears where there is nothing to group.
  const allNodes = insertSubdivisionTier(baseNodes);

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
      collapsedBelowThreshold: view.collapsedBelowThreshold,
      hidden: {
        vacant: view.excluded.vacant,
        ungraded: view.excluded.ungraded,
        belowGrade: view.excluded.belowGrade,
        inactive: view.excluded.inactive,
        total:
          view.excluded.vacant +
          view.excluded.ungraded +
          view.excluded.belowGrade +
          view.excluded.inactive,
      },
    },
  };
}
