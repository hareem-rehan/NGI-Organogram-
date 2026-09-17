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
  /** The leadership threshold. What happens below it is `belowThreshold`. */
  minGradeLevel: number;
  /**
   * What to do with positions graded below `minGradeLevel`.
   *
   * - `"collapse"` (default) keeps them in the graph but leaves them
   *   folded away behind their manager's expand control, so the chart
   *   OPENS at leadership level and still drills all the way down. This
   *   is the stakeholder's "till L7 we will show names of team members
   *   with the roles, and each box should be expandable".
   * - `"hide"` removes them from the chart entirely.
   *
   * Neither deletes anything.
   */
  belowThreshold: "collapse" | "hide";
  /**
   * What to do with a position that has no job grade at all.
   *
   * Default `false` — SHOWN. A position with no grade cannot be placed
   * against the L7 threshold, but hiding it means a company still setting
   * up (no grades assigned yet) sees an empty chart no matter how many
   * positions it adds. Showing it lets the org chart be built and read
   * before grades exist; when `hideUngraded` is `true` instead, such a
   * position is excluded and counted, so a missing grade reads as missing
   * data rather than a vanished role.
   */
  hideUngraded: boolean;
  /**
   * Whether to drop positions nobody currently holds.
   *
   * Default `false`. The company's own chart shows every approved role
   * and simply leaves the name off the ones that are unfilled, and their
   * position list is a role ladder — most rungs have no occupant — so
   * hiding them emptied the chart rather than tidying it.
   */
  hideVacant: boolean;
  /** Group positions under a synthetic department tier below the root. */
  departmentFirst: boolean;
  /**
   * Drop deactivated (INACTIVE) positions from the chart. Default `true`:
   * a deactivated role is not part of the current organisation, so it
   * should not appear. Its active reports (if any) re-attach to the
   * nearest visible ancestor, exactly as for any other filtered node, so
   * hiding it never orphans anyone. The root is always kept.
   */
  hideInactive: boolean;
}

export const DEFAULT_LEADERSHIP_VIEW_OPTIONS: LeadershipViewOptions = {
  minGradeLevel: DEFAULT_LEADERSHIP_MIN_GRADE_LEVEL,
  belowThreshold: "collapse",
  hideUngraded: false,
  hideVacant: false,
  departmentFirst: true,
  hideInactive: true,
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
  /**
   * Of those, the ones graded below the threshold — present in the graph
   * but folded away by default (see `belowThreshold: "collapse"`). Empty
   * when `belowThreshold` is `"hide"`, because then they are not in
   * `visiblePositionIds` at all.
   */
  belowThresholdIds: ReadonlySet<string>;
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
    /** Left off the chart entirely — only ever non-zero when `belowThreshold` is `"hide"`. */
    belowGrade: number;
    /** Deactivated positions, dropped from the chart. */
    inactive: number;
  };
  /** Kept, but folded away behind their manager's expand control. */
  collapsedBelowThreshold: number;
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
): "visible" | "vacant" | "ungraded" | "belowGrade" | "inactive" {
  if (isRoot) return "visible";
  // Status first: a deactivated role is not part of the current org at
  // all, so it drops out before any grade/occupancy consideration.
  if (options.hideInactive && node.positionStatus === "INACTIVE") return "inactive";
  if (options.hideVacant && node.occupancyStatus === "vacant") return "vacant";
  if (node.jobGradeLevel === null) return options.hideUngraded ? "ungraded" : "visible";
  if (node.jobGradeLevel < options.minGradeLevel) {
    // "collapse" keeps the node in the graph — it is reachable by
    // expanding its manager, and only the DEFAULT collapse state hides it.
    return options.belowThreshold === "hide" ? "belowGrade" : "visible";
  }
  return "visible";
}

/** Graded, and graded below the threshold. An ungraded position is not "below" anything. */
export function isBelowThreshold(node: OrganogramNode, minGradeLevel: number): boolean {
  return node.jobGradeLevel !== null && node.jobGradeLevel < minGradeLevel;
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
  options: LeadershipViewOptions = DEFAULT_LEADERSHIP_VIEW_OPTIONS,
  /**
   * Active departments to show as an empty heading even when no position
   * lives in them yet — so a department appears on the chart the moment it
   * is created, before any role is added. Omitted (existing callers), only
   * departments that actually have a visible member appear, exactly as
   * before. Empty department headings only make sense with a root to hang
   * them off and a department tier to hang them in.
   */
  allDepartments: readonly { id: string; name: string; color: string | null }[] = []
): LeadershipView {
  const byId = new Map(nodes.map((n) => [n.positionId, n]));

  // A company has at most one root (enforced by a partial unique index),
  // and analyzeOrganogramSafety has already discarded extra/cyclic roots.
  const rootPositionId =
    nodes.find((n) => n.primaryReportsToPositionId === null)?.positionId ?? null;

  const excluded = { vacant: 0, ungraded: 0, belowGrade: 0, inactive: 0 };
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

  // Departments with no visible position yet — added as empty headings so
  // a freshly-created department is visible on the chart before it has a
  // single role. memberCount stays 0 (never set in `memberCounts`).
  if (options.departmentFirst && rootPositionId !== null) {
    for (const dept of allDepartments) {
      if (!departmentsInUse.has(dept.id)) {
        departmentsInUse.set(dept.id, { name: dept.name, color: dept.color });
      }
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

  const belowThresholdIds = new Set(
    visible
      .filter((n) => n.positionId !== rootPositionId && isBelowThreshold(n, options.minGradeLevel))
      .map((n) => n.positionId)
  );

  return {
    rootPositionId,
    departmentGroups,
    visiblePositionIds: visibleIds,
    belowThresholdIds,
    parentByPositionId,
    excluded,
    collapsedBelowThreshold: belowThresholdIds.size,
  };
}
