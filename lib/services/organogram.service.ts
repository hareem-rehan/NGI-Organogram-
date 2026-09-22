import "server-only";

import { findCompanyById } from "@/lib/repositories/company.repository";
import { getOrganogramRawData } from "@/lib/repositories/organogram.repository";
import { listDepartmentsForCompany } from "@/lib/repositories/department.repository";
import {
  analyzeOrganogramSafety,
  buildOrganogramGraph,
  type OrganogramEdge,
  type OrganogramNode,
} from "@/lib/domain/organogram";
import {
  projectLeadershipGraph,
  type LeadershipSummary,
} from "@/lib/domain/organogram-leadership-graph";
import { DEFAULT_LEADERSHIP_VIEW_OPTIONS } from "@/lib/domain/organogram-leadership";
import { NotFoundError } from "@/lib/domain/errors";

export interface OrganogramCompanySummary {
  name: string;
  code: string;
  /** ISO date (YYYY-MM-DD) — the effective date occupancy was computed as of. */
  effectiveDate: string;
}

export interface OrganogramSafetySummary {
  /** False only when the company has zero positions, or every position is unreachable from a root. */
  hasRoot: boolean;
  /** Always 0 under the current schema (DB partial unique index) — kept for forward-compatibility, same as docs/DASHBOARD_METRICS.md §H. */
  extraRootCount: number;
  /** Positions excluded from `nodes`/`edges` because their reporting chain forms a cycle. */
  cyclePositionCount: number;
  /** Positions excluded from `nodes`/`edges` because their reporting chain cannot reach the root (dangling parent). */
  disconnectedPositionCount: number;
}

/**
 * The full, whitelisted organogram data contract
 * (docs/ORGANOGRAM_RENDERING.md "Hierarchy Data Contract"). `nodes`/`edges`
 * cover the ENTIRE company hierarchy — every safe position, in its real
 * reporting shape. What the CHART draws is narrower; that is
 * `OrganogramChartData` below, built from this.
 *
 * No salary, contact, address, SSO/auth, or other confidential HR field
 * is present on `OrganogramNode` by construction (no such field exists on
 * the type) — only an occupant's display name, never the raw Employee
 * record.
 */
export interface OrganogramData {
  company: OrganogramCompanySummary;
  nodes: OrganogramNode[];
  edges: OrganogramEdge[];
  safety: OrganogramSafetySummary;
}

/**
 * What the organogram actually draws, since the Demo 1 stakeholder
 * feedback: the department tier is present as synthetic
 * `kind: "department"` nodes, and positions that are below the grade
 * threshold, vacant, or ungraded are absent.
 *
 * They are absent from THIS READ only. Every one of them still exists,
 * is still managed on the Positions page, still counted on the dashboard,
 * and still in the audit log — `getOrganogramData` above still returns
 * all of them, and is what every non-chart caller should use.
 */
export interface OrganogramChartData extends OrganogramData {
  /**
   * What the projection reshaped and left out. Surfaced rather than
   * swallowed so the UI can say plainly that the chart is a leadership
   * view — a chart that quietly shows a third of the company is worse
   * than one that shows a third and says so.
   */
  leadership: LeadershipSummary;
}

export interface GetOrganogramDataInput {
  companyId: string;
  /** Injectable for deterministic tests; defaults to the real current time. */
  now?: Date;
}

/**
 * Assembles the read-only organogram payload. A cycle or a disconnected
 * position is isolated (excluded from `nodes`/`edges`, counted in
 * `safety`) rather than rendered with a fabricated relationship or
 * allowed to hang the traversal — see
 * .claude/skills/organogram-hierarchy-safety/SKILL.md.
 */
export async function getOrganogramData(input: GetOrganogramDataInput): Promise<OrganogramData> {
  const now = input.now ?? new Date();
  const { companyId } = input;

  const company = await findCompanyById(companyId);
  if (!company) throw new NotFoundError("Company", companyId);

  const raw = await getOrganogramRawData(companyId, now);

  const safety = analyzeOrganogramSafety(
    raw.positions.map((p) => ({
      id: p.id,
      status: p.status,
      primaryReportsToPositionId: p.primaryReportsToPositionId,
    }))
  );

  const departmentsById = new Map(raw.departments.map((d) => [d.id, d]));
  const { nodes, edges } = buildOrganogramGraph({
    positions: raw.positions,
    safePositionIds: safety.safePositionIds,
    departmentsById,
    jobGradeNamesById: raw.jobGradeNamesById,
    jobGradesById: raw.jobGradesById,
    jobFamilyNamesById: raw.jobFamilyNamesById,
    occupantNamesByPositionId: raw.occupantNamesByPositionId,
    occupantEmployeeIdsByPositionId: raw.occupantEmployeeIdsByPositionId,
  });

  return {
    company: {
      name: company.name,
      code: company.code,
      effectiveDate: now.toISOString().slice(0, 10),
    },
    nodes,
    edges,
    safety: {
      hasRoot: safety.rootPositionId !== null,
      extraRootCount: safety.extraRootIds.length,
      cyclePositionCount: safety.cyclePositionIds.length,
      disconnectedPositionCount: safety.disconnectedPositionIds.length,
    },
  };
}

/**
 * The chart's own read: `getOrganogramData` plus the leadership
 * projection (docs/DECISIONS.md §2b).
 *
 * One function, one options object, two callers — the interactive chart
 * and the export both go through here, so an exported PNG can never show
 * a different organogram from the screen it was exported from. Switching
 * any part of the Demo 1 reshape back off is a change to
 * DEFAULT_LEADERSHIP_VIEW_OPTIONS, not a hunt through the UI.
 */
export async function getOrganogramChartData(
  input: GetOrganogramDataInput
): Promise<OrganogramChartData> {
  const full = await getOrganogramData(input);

  // Active departments, so a department with no position in it yet still
  // appears on the chart as an empty heading (an archived department is
  // left off). Cheap extra read; keeps getOrganogramData's contract as-is.
  const activeDepartments = (await listDepartmentsForCompany(input.companyId))
    .filter((d) => d.status === "ACTIVE")
    .map((d) => ({
      id: d.id,
      name: d.name,
      code: d.code,
      color: d.color,
      parentDepartmentId: d.parentDepartmentId,
    }));

  const { nodes, edges, summary } = projectLeadershipGraph(
    full.nodes,
    DEFAULT_LEADERSHIP_VIEW_OPTIONS,
    activeDepartments
  );
  return { ...full, nodes, edges, leadership: summary };
}
