import { describe, expect, it } from "vitest";

import type { OrganogramNode } from "./organogram";
import {
  buildLeadershipView,
  departmentGroupId,
  isDepartmentGroupId,
  DEFAULT_LEADERSHIP_MIN_GRADE_LEVEL,
  DEFAULT_LEADERSHIP_VIEW_OPTIONS,
  type LeadershipViewOptions,
} from "./organogram-leadership";

const ENG = "dept-eng";
const HR = "dept-hr";
const EXEC = "dept-exec";

function node(overrides: Partial<OrganogramNode> & { positionId: string }): OrganogramNode {
  return {
    positionCode: `POS-${overrides.positionId}`,
    title: `Title ${overrides.positionId}`,
    departmentId: ENG,
    departmentName: "Engineering",
    departmentCode: "ENG",
    departmentColor: "#16a34a",
    jobGradeId: "grade",
    jobGradeName: "Leadership",
    jobGradeCode: "L9",
    jobGradeLevel: 9,
    organizationalLevel: 2,
    positionStatus: "ACTIVE",
    occupancyStatus: "occupied",
    occupantDisplayName: "Someone",
    occupantEmployeeId: "emp",
    directReportCount: 0,
    primaryReportsToPositionId: "ceo",
    hasChildren: false,
    isPlanned: false,
    isActive: true,
    ...overrides,
  };
}

function ceo(): OrganogramNode {
  return node({
    positionId: "ceo",
    title: "CEO",
    departmentId: EXEC,
    departmentName: "Executive",
    organizationalLevel: 1,
    primaryReportsToPositionId: null,
    jobGradeCode: "L18",
    jobGradeLevel: 18,
  });
}

function opts(overrides: Partial<LeadershipViewOptions> = {}): LeadershipViewOptions {
  return { ...DEFAULT_LEADERSHIP_VIEW_OPTIONS, ...overrides };
}

/**
 * The strictest settings — drop below-threshold and vacant positions from
 * the graph entirely, rather than the default of keeping them and folding
 * the junior ones away. Both behaviours are supported and both are
 * tested; this helper is for the tests that are specifically about
 * REMOVAL, so the default flip (2026-09-15, stakeholder: "till L7 we will
 * show names of team members with the roles, and each box should be
 * expandable") did not quietly delete their coverage.
 */
function hidingOpts(overrides: Partial<LeadershipViewOptions> = {}): LeadershipViewOptions {
  return opts({ belowThreshold: "hide", hideVacant: true, ...overrides });
}

describe("department group ids", () => {
  it("namespaces a department id so it can never collide with a position id", () => {
    const id = departmentGroupId("abc");
    expect(id).toBe("dept:abc");
    expect(isDepartmentGroupId(id)).toBe(true);
    // A bare UUID (what a real positionId looks like) must not be mistaken for one.
    expect(isDepartmentGroupId("11111111-1111-4111-8111-111111111111")).toBe(false);
  });
});

describe("buildLeadershipView — department-first shape", () => {
  it("puts departments directly under the founder, with roles beneath their department", () => {
    const cto = node({ positionId: "cto", title: "CTO", departmentId: ENG });
    const chro = node({
      positionId: "chro",
      title: "CHO",
      departmentId: HR,
      departmentName: "Human Resources",
    });

    const view = buildLeadershipView([ceo(), cto, chro], opts());

    expect(view.rootPositionId).toBe("ceo");
    expect(view.departmentGroups.map((d) => d.name)).toEqual(["Engineering", "Human Resources"]);
    // Each role hangs off its DEPARTMENT, not directly off the CEO.
    expect(view.parentByPositionId.get("cto")).toBe(departmentGroupId(ENG));
    expect(view.parentByPositionId.get("chro")).toBe(departmentGroupId(HR));
  });

  it("keeps a real reporting chain intact when manager and report share a department", () => {
    const cto = node({ positionId: "cto", title: "CTO" });
    const vp = node({
      positionId: "vp",
      title: "VP Engineering",
      primaryReportsToPositionId: "cto",
    });
    const lead = node({
      positionId: "lead",
      title: "Tech Lead",
      primaryReportsToPositionId: "vp",
      jobGradeCode: "L7",
      jobGradeLevel: 7,
    });

    const view = buildLeadershipView([ceo(), cto, vp, lead], opts());

    // Only the top of the department's chain re-parents to the department.
    expect(view.parentByPositionId.get("cto")).toBe(departmentGroupId(ENG));
    expect(view.parentByPositionId.get("vp")).toBe("cto");
    expect(view.parentByPositionId.get("lead")).toBe("vp");
  });

  it("counts every position under a department, not just its direct children", () => {
    const cto = node({ positionId: "cto" });
    const vp = node({ positionId: "vp", primaryReportsToPositionId: "cto" });

    const view = buildLeadershipView([ceo(), cto, vp], opts());

    expect(view.departmentGroups.find((d) => d.departmentId === ENG)?.memberCount).toBe(2);
  });

  it("orders departments deterministically by name", () => {
    const a = node({ positionId: "a", departmentId: "d-z", departmentName: "Zeta" });
    const b = node({ positionId: "b", departmentId: "d-a", departmentName: "Alpha" });
    const c = node({ positionId: "c", departmentId: "d-m", departmentName: "Mu" });

    const view = buildLeadershipView([ceo(), a, b, c], opts());

    expect(view.departmentGroups.map((d) => d.name)).toEqual(["Alpha", "Mu", "Zeta"]);
  });
});

describe("buildLeadershipView — the L7 threshold", () => {
  it("defaults to L7, matching the company's own level mapping", () => {
    expect(DEFAULT_LEADERSHIP_MIN_GRADE_LEVEL).toBe(7);
  });

  it("with belowThreshold 'hide', shows L7 and above and drops the rest", () => {
    const principal = node({ positionId: "principal", jobGradeCode: "L7", jobGradeLevel: 7 });
    const seniorII = node({ positionId: "senior2", jobGradeCode: "L6", jobGradeLevel: 6 });
    const engineer = node({ positionId: "eng", jobGradeCode: "L3", jobGradeLevel: 3 });

    const view = buildLeadershipView([ceo(), principal, seniorII, engineer], hidingOpts());

    expect(view.visiblePositionIds.has("principal")).toBe(true);
    expect(view.visiblePositionIds.has("senior2")).toBe(false);
    expect(view.visiblePositionIds.has("eng")).toBe(false);
    expect(view.excluded.belowGrade).toBe(2);
  });

  it("uses the grade level, never the job title — a junior titled 'Lead' stays hidden", () => {
    const impostor = node({
      positionId: "impostor",
      title: "Tech Lead",
      jobGradeCode: "L4",
      jobGradeLevel: 4,
    });

    const view = buildLeadershipView([ceo(), impostor], hidingOpts());

    expect(view.visiblePositionIds.has("impostor")).toBe(false);
  });

  it("honours a retuned threshold without a code change", () => {
    const seniorII = node({ positionId: "senior2", jobGradeCode: "L6", jobGradeLevel: 6 });

    expect(
      buildLeadershipView([ceo(), seniorII], opts({ minGradeLevel: 6 })).visiblePositionIds.has(
        "senior2"
      )
    ).toBe(true);
  });

  it("never confuses organizationalLevel with grade level — they run in opposite directions", () => {
    // Deep in the tree (organizationalLevel 9) but a senior grade: must show.
    const deepLeader = node({
      positionId: "deep",
      organizationalLevel: 9,
      jobGradeCode: "L12",
      jobGradeLevel: 12,
    });
    // Shallow (organizationalLevel 2) but junior grade: must not.
    const shallowJunior = node({
      positionId: "shallow",
      organizationalLevel: 2,
      jobGradeCode: "L3",
      jobGradeLevel: 3,
    });

    const view = buildLeadershipView([ceo(), deepLeader, shallowJunior], hidingOpts());

    expect(view.visiblePositionIds.has("deep")).toBe(true);
    expect(view.visiblePositionIds.has("shallow")).toBe(false);
  });
});

describe("buildLeadershipView — exclusions", () => {
  it("hides vacant positions and counts them", () => {
    const vacant = node({
      positionId: "vacant",
      occupancyStatus: "vacant",
      occupantDisplayName: null,
      occupantEmployeeId: null,
    });

    const view = buildLeadershipView([ceo(), vacant], hidingOpts());

    expect(view.visiblePositionIds.has("vacant")).toBe(false);
    expect(view.excluded.vacant).toBe(1);
  });

  it("shows ungraded positions by default, so a company still assigning grades still sees its chart", () => {
    // Default flipped 2026-09-17: a position with no grade yet is SHOWN,
    // not hidden. Otherwise a company that has not set up grades adds
    // positions and watches nothing appear.
    const ungraded = node({
      positionId: "ungraded",
      jobGradeId: null,
      jobGradeName: null,
      jobGradeCode: null,
      jobGradeLevel: null,
    });

    const view = buildLeadershipView([ceo(), ungraded], opts());

    expect(view.visiblePositionIds.has("ungraded")).toBe(true);
    expect(view.excluded.ungraded).toBe(0);
  });

  it("hides ungraded positions and counts them separately when that is chosen instead", () => {
    const ungraded = node({
      positionId: "ungraded",
      jobGradeId: null,
      jobGradeName: null,
      jobGradeCode: null,
      jobGradeLevel: null,
    });

    const view = buildLeadershipView([ceo(), ungraded], opts({ hideUngraded: true }));

    expect(view.visiblePositionIds.has("ungraded")).toBe(false);
    expect(view.excluded.ungraded).toBe(1);
    expect(view.excluded.belowGrade).toBe(0);
  });

  it("never excludes the root — a chart with no top is not a chart", () => {
    const vacantRoot = node({
      positionId: "ceo",
      organizationalLevel: 1,
      primaryReportsToPositionId: null,
      occupancyStatus: "vacant",
      occupantDisplayName: null,
      jobGradeId: null,
      jobGradeLevel: null,
    });

    const view = buildLeadershipView([vacantRoot], opts());

    expect(view.rootPositionId).toBe("ceo");
    expect(view.visiblePositionIds.has("ceo")).toBe(true);
  });

  it("re-attaches a report whose manager was filtered out, rather than orphaning it", () => {
    // Lead reports to a vacant manager, which reports to the CTO.
    const cto = node({ positionId: "cto" });
    const vacantManager = node({
      positionId: "vacant-mgr",
      primaryReportsToPositionId: "cto",
      occupancyStatus: "vacant",
      occupantDisplayName: null,
    });
    const lead = node({
      positionId: "lead",
      primaryReportsToPositionId: "vacant-mgr",
      jobGradeCode: "L7",
      jobGradeLevel: 7,
    });

    const view = buildLeadershipView([ceo(), cto, vacantManager, lead], hidingOpts());

    expect(view.visiblePositionIds.has("vacant-mgr")).toBe(false);
    // Still rendered, now hanging off the nearest VISIBLE ancestor.
    expect(view.visiblePositionIds.has("lead")).toBe(true);
    expect(view.parentByPositionId.get("lead")).toBe("cto");
  });

  it("counts each exclusion reason once, so the totals reconcile", () => {
    const vacantAndJunior = node({
      positionId: "both",
      occupancyStatus: "vacant",
      occupantDisplayName: null,
      jobGradeCode: "L2",
      jobGradeLevel: 2,
    });

    const view = buildLeadershipView([ceo(), vacantAndJunior], hidingOpts());

    const totalExcluded = view.excluded.vacant + view.excluded.ungraded + view.excluded.belowGrade;
    expect(totalExcluded).toBe(1);
    expect(view.visiblePositionIds.size + totalExcluded).toBe(2);
  });
});

describe("buildLeadershipView — below the threshold, by default, is folded not dropped", () => {
  it("keeps junior roles in the graph and flags them, so a box can still expand into them", () => {
    const principal = node({ positionId: "principal", jobGradeCode: "L7", jobGradeLevel: 7 });
    const senior = node({
      positionId: "senior",
      primaryReportsToPositionId: "principal",
      jobGradeCode: "L6",
      jobGradeLevel: 6,
    });

    const view = buildLeadershipView([ceo(), principal, senior], opts());

    expect(view.visiblePositionIds.has("senior")).toBe(true);
    expect(view.belowThresholdIds.has("senior")).toBe(true);
    expect(view.belowThresholdIds.has("principal")).toBe(false);
    // Folded away is not the same as excluded, and the counts say so.
    expect(view.excluded.belowGrade).toBe(0);
    expect(view.collapsedBelowThreshold).toBe(1);
    // It keeps its real manager, so expanding that manager reveals it.
    expect(view.parentByPositionId.get("senior")).toBe("principal");
  });

  it("shows a role nobody holds, rather than dropping it", () => {
    // The company's own chart shows every approved role and simply leaves
    // the name off the unfilled ones.
    const unfilled = node({
      positionId: "unfilled",
      occupancyStatus: "vacant",
      occupantDisplayName: null,
      occupantEmployeeId: null,
    });

    const view = buildLeadershipView([ceo(), unfilled], opts());

    expect(view.visiblePositionIds.has("unfilled")).toBe(true);
    expect(view.excluded.vacant).toBe(0);
  });

  it("shows an ungraded position but never treats it as below-threshold — no grade is not a low grade", () => {
    const ungraded = node({ positionId: "ungraded", jobGradeId: null, jobGradeLevel: null });

    const view = buildLeadershipView([ceo(), ungraded], opts());

    // Shown by default now, but "no grade" and "graded below L7" are
    // different states: only the latter is folded away.
    expect(view.visiblePositionIds.has("ungraded")).toBe(true);
    expect(view.belowThresholdIds.has("ungraded")).toBe(false);
    expect(view.excluded.ungraded).toBe(0);
  });

  it("never flags the root as below the threshold, whatever its grade", () => {
    const junyorRoot = node({
      positionId: "ceo",
      primaryReportsToPositionId: null,
      jobGradeCode: "L2",
      jobGradeLevel: 2,
    });

    const view = buildLeadershipView([junyorRoot], opts());

    expect(view.belowThresholdIds.has("ceo")).toBe(false);
    expect(view.collapsedBelowThreshold).toBe(0);
  });
});

describe("buildLeadershipView — departmentFirst disabled", () => {
  it("falls back to the real reporting chain with no synthetic department tier", () => {
    const cto = node({ positionId: "cto" });

    const view = buildLeadershipView([ceo(), cto], opts({ departmentFirst: false }));

    expect(view.departmentGroups).toEqual([]);
    expect(view.parentByPositionId.get("cto")).toBe("ceo");
  });
});

describe("buildLeadershipView — determinism", () => {
  it("produces identical output for identical input", () => {
    const nodes = [
      ceo(),
      node({ positionId: "a", departmentId: HR, departmentName: "Human Resources" }),
      node({ positionId: "b" }),
    ];

    const first = buildLeadershipView(nodes, opts());
    const second = buildLeadershipView(nodes, opts());

    expect(JSON.stringify(first.departmentGroups)).toBe(JSON.stringify(second.departmentGroups));
    expect([...first.parentByPositionId.entries()]).toEqual([
      ...second.parentByPositionId.entries(),
    ]);
  });
});
