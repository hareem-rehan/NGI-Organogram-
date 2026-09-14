import type { OrganogramNode } from "./organogram";

/**
 * Leadership view (Demo 1 stakeholder feedback).
 *
 * Reshapes the organogram for DISPLAY into:
 *
 *   Founder -> Department -> that department's leadership chain
 *
 * and narrows it to leadership-grade roles only.
 *
 * Four things this deliberately does NOT do:
 *
 * 1. It never changes anyone's real manager, level, or department.
 *    `CLAUDE.md` §2 is explicit that "department headings / visual
 *    grouping do not count as organizational levels", so the department
 *    tier here is a SYNTHETIC display node. `organizationalLevel` keeps
 *    meaning exactly what it always did — distance from the root along
 *    real reporting lines. Nothing here writes to the database.
 *
 * 2. It never deletes or hides data anywhere else. Excluded positions
 *    still exist, still appear in the Positions list, in search, in the
 *    dashboard counts, and in a full-graph export. This is a rendering
 *    filter, not a data filter.
 *
 * 3. It does not key off job TITLES. The stakeholder asked for the
 *    threshold to be "based on the employee/position level rather than
 *    hardcoding specific job titles", so the only input is the position's
 *    job-grade level. Titles are used once, offline, to POPULATE those
 *    grades — never at render time.
 *
 * 4. It does not re-derive hierarchy safety. It consumes nodes that
 *    `buildOrganogramGraph` already produced (cycle-checked by
 *    `analyzeOrganogramSafety`), so no invariant from
 *    `.claude/skills/organogram-hierarchy-safety` is reimplemented here.
 */

/** Prefix making a synthetic department node id impossible to confuse with a Position UUID. */
export const DEPARTMENT_GROUP_ID_PREFIX = "dept:";

export function departmentGroupId(departmentId: string): string {
  return `${DEPARTMENT_GROUP_ID_PREFIX}${departmentId}`;
}

export function isDepartmentGroupId(id: string): boolean {
  return id.startsWith(DEPARTMENT_GROUP_ID_PREFIX);
}

/**
 * Minimum job-grade level treated as leadership.
 *
 * L7 ("Principal Software Engineer" on the IC track, "Tech Lead" on the
 * manager track) per the company's own level-mapping document, confirmed
 * by the stakeholder. The scale runs L2..L18, higher being more senior —
 * the OPPOSITE direction to `organizationalLevel`, which counts depth
 * from the root. Keeping the two apart matters: `CLAUDE.md` §2 requires
 * organizational level and job grade to stay independent, and neither
 * may be derived from the other.
 */
export const DEFAULT_LEADERSHIP_MIN_GRADE_LEVEL = 7;

export interface LeadershipViewOptions {
  /** Positions graded below this are excluded from the chart. Never deletes them. */
  minGradeLevel: number;
  /**
   * Positions with no job grade at all cannot be shown to BE leadership,
   * so they are excluded and counted. The count is surfaced rather than
   * swallowed, so a missing grade looks like missing data instead of a
   * position that mysteriously vanished.
   */
  hideUngraded: boolean;
  /** Vacant positions are excluded (the chart should not imply many unfilled roles). */
  hideVacant: boolean;
  /** Group positions under a synthetic department tier below the root. */
  departmentFirst: boolean;
}

export const DEFAULT_LEADERSHIP_VIEW_OPTIONS: LeadershipViewOptions = {
  minGradeLevel: DEFAULT_LEADERSHIP_MIN_GRADE_LEVEL,
  hideUngraded: true,
  hideVacant: true,
  departmentFirst: true,
};

export interface DepartmentGroupNode {
  /** Synthetic id, `dept:<departmentId>`. */
  id: string;
  departmentId: string;
  name: string;
  color: string | null;
  /** Visible positions under this department, directly or deeper in a chain. */
  memberCount: number;
}

export interface LeadershipView {
  /** The single root position, if one survived the filters. */
  rootPositionId: string | null;
  /** Synthetic department tier, deterministically ordered. */
  departmentGroups: DepartmentGroupNode[];
  /** Positions that should render. */
  visiblePositionIds: ReadonlySet<string>;
  /** Display parent of each visible position — a position id, or a department group id. */
  parentByPositionId: ReadonlyMap<string, string>;
  /**
   * Why things were left out, so the UI can say so plainly. Mutually
   * exclusive and evaluated in this order, so the counts always sum to
   * (total - visible) without double-counting a node that fails twice.
   */
  excluded: {
    vacant: number;
    ungraded: number;
    belowGrade: number;
  };
}

/**
 * The root is the chart's anchor and is always kept when it exists, even
 * if it would fail a filter — a chart with no top is not a chart. In
 * practice a company's root is its CEO and comfortably clears any
 * leadership threshold; this only matters for a half-configured company.
 */
function classify(
  node: OrganogramNode,
  options: LeadershipViewOptions,
  isRoot: boolean
): "visible" | "vacant" | "ungraded" | "belowGrade" {
  if (isRoot) return "visible";
  if (options.hideVacant && node.occupancyStatus === "vacant") return "vacant";
  if (node.jobGradeLevel === null) return options.hideUngraded ? "ungraded" : "visible";
  if (node.jobGradeLevel < options.minGradeLevel) return "belowGrade";
  return "visible";
}

/**
 * Builds the leadership view.
 *
 * The parenting rule is the whole point of the module:
 *
 * - The root position stays at the top.
 * - A visible position keeps its real manager as display parent IF that
 *   manager is also visible AND sits in the same department. That is what
 *   preserves a genuine chain like CTO -> VP -> Director inside Engineering.
 * - Otherwise the position becomes the top of its department's subtree and
 *   attaches to that department's synthetic node. That is what turns
 *   "CTO reports to the CEO" into "CTO sits under Engineering".
 *
 * Because the manager lookup walks up through VISIBLE ancestors only, a
 * position whose manager was filtered out (vacant, ungraded, or too
 * junior) is re-attached rather than orphaned — nothing silently
 * disappears because of a gap in the middle of a chain.
 */
export function buildLeadershipView(
  nodes: readonly OrganogramNode[],
  options: LeadershipViewOptions = DEFAULT_LEADERSHIP_VIEW_OPTIONS
): LeadershipView {
  const byId = new Map(nodes.map((n) => [n.positionId, n]));

  // A company has at most one root (enforced by a partial unique index),
  // and analyzeOrganogramSafety has already discarded extra/cyclic roots.
  const rootPositionId =
    nodes.find((n) => n.primaryReportsToPositionId === null)?.positionId ?? null;

  const excluded = { vacant: 0, ungraded: 0, belowGrade: 0 };
  const visible: OrganogramNode[] = [];
  for (const node of nodes) {
    const verdict = classify(node, options, node.positionId === rootPositionId);
    if (verdict === "visible") visible.push(node);
    else excluded[verdict] += 1;
  }
  const visibleIds = new Set(visible.map((n) => n.positionId));

  /** Nearest ancestor that survived the filters, walking real reporting lines. */
  function nearestVisibleAncestor(node: OrganogramNode): OrganogramNode | null {
    const seen = new Set<string>([node.positionId]);
    let current = node.primaryReportsToPositionId;
    while (current) {
      if (seen.has(current)) return null; // defensive; safety analysis already excludes cycles
      seen.add(current);
      const ancestor = byId.get(current);
      if (!ancestor) return null;
      if (visibleIds.has(ancestor.positionId)) return ancestor;
      current = ancestor.primaryReportsToPositionId;
    }
    return null;
  }

  const parentByPositionId = new Map<string, string>();
  const departmentsInUse = new Map<string, { name: string; color: string | null }>();
  const memberCounts = new Map<string, number>();

  for (const node of visible) {
    if (node.positionId === rootPositionId) continue;

    const ancestor = nearestVisibleAncestor(node);
    const keepsRealManager =
      ancestor !== null &&
      ancestor.positionId !== rootPositionId &&
      (!options.departmentFirst || ancestor.departmentId === node.departmentId);

    if (keepsRealManager && ancestor) {
      parentByPositionId.set(node.positionId, ancestor.positionId);
    } else if (options.departmentFirst) {
      parentByPositionId.set(node.positionId, departmentGroupId(node.departmentId));
    } else if (ancestor) {
      parentByPositionId.set(node.positionId, ancestor.positionId);
    } else if (rootPositionId) {
      parentByPositionId.set(node.positionId, rootPositionId);
    }

    if (options.departmentFirst) {
      departmentsInUse.set(node.departmentId, {
        name: node.departmentName,
        color: node.departmentColor,
      });
      memberCounts.set(node.departmentId, (memberCounts.get(node.departmentId) ?? 0) + 1);
    }
  }

  const departmentGroups: DepartmentGroupNode[] = [...departmentsInUse.entries()]
    .map(([departmentId, meta]) => ({
      id: departmentGroupId(departmentId),
      departmentId,
      name: meta.name,
      color: meta.color,
      memberCount: memberCounts.get(departmentId) ?? 0,
    }))
    // Deterministic ordering, matching the rest of this domain layer: name
    // first so the chart reads alphabetically, id as tiebreak so two
    // departments sharing a name still order stably.
    .sort((a, b) => a.name.localeCompare(b.name) || a.departmentId.localeCompare(b.departmentId));

  return {
    rootPositionId,
    departmentGroups,
    visiblePositionIds: visibleIds,
    parentByPositionId,
    excluded,
  };
}
