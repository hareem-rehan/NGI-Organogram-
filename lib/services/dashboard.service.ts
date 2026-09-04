import "server-only";

import { findCompanyById } from "@/lib/repositories/company.repository";
import {
  buildDepartmentSummaries,
  countActiveAssignedEmployees,
  countEligibleActivePositions,
  countOccupiedActivePositions,
  countOccupiedEligibleActivePositions,
  findActivePositionsInInactiveDepartments,
  findAssignmentsWithInactiveEmployee,
  findAssignmentsWithInactivePosition,
  findEmployeesWithMultipleEffectiveAssignments,
  findPositionsWithMultipleEffectiveOccupants,
  findRootPositionRow,
  getAssignmentCounts,
  getDepartmentCounts,
  getEmployeeCounts,
  getPositionCounts,
  getPositionHierarchySnapshot,
  type DepartmentSummaryRow,
} from "@/lib/repositories/dashboard.repository";
import {
  buildLevelDistribution,
  calculateVacancyRate,
  detectHierarchyIntegrityWarnings,
  findMaxLevel,
  type VacancyRate,
} from "@/lib/domain/dashboard";
import { NotFoundError } from "@/lib/domain/errors";

export interface DashboardWarning {
  /** Stable identifier for the warning category — docs/DASHBOARD_METRICS.md §H. */
  id: string;
  title: string;
  description: string;
  count: number;
  link?: { href: string; label: string };
}

export interface DashboardCompanySummary {
  name: string;
  code: string;
  timezone: string;
  /** ISO date (YYYY-MM-DD) — the effective date every other field was computed as of. */
  effectiveDate: string;
  /** ISO datetime — when this payload was generated. */
  lastRefreshed: string;
}

export interface DashboardDepartmentSummary {
  totalActive: number;
  /** null when the caller isn't authorized to see it (VIEWER). */
  totalInactive: number | null;
  topLevelActive: number;
  nestedActive: number;
}

export interface DashboardPositionSummary {
  totalActive: number;
  occupied: number;
  vacant: number;
  planned: number;
  inactive: number | null;
  root: { id: string; title: string; status: string; isActive: boolean } | null;
  maxLevel: number | null;
  levelDistribution: { level: number; count: number }[];
  disconnectedActiveCount: number;
}

export interface DashboardEmployeeSummary {
  active: number;
  activeAssigned: number;
  activeUnassigned: number;
  inactiveOrTerminated: number | null;
}

export interface DashboardAssignmentSummary {
  currentPrimary: number;
  future: number | null;
  multiOccupantPositionCount: number;
  multiPrimaryEmployeeCount: number;
}

export interface DashboardDepartmentRow {
  id: string;
  name: string;
  code: string;
  color: string | null;
  status: "ACTIVE" | "INACTIVE";
  activePositionCount: number;
  occupiedPositionCount: number;
  vacantPositionCount: number;
  plannedPositionCount: number;
  activeAssignedEmployeeCount: number;
  activeUnassignedAttributed: false;
  maxOrganizationalLevel: number | null;
  childDepartmentCount: number;
}

export interface DashboardSummary {
  company: DashboardCompanySummary;
  departments: DashboardDepartmentSummary;
  positions: DashboardPositionSummary;
  employees: DashboardEmployeeSummary;
  assignments: DashboardAssignmentSummary;
  vacancyRate: VacancyRate;
  departmentSummaries: DashboardDepartmentRow[] | null;
  warnings: DashboardWarning[] | null;
  sectionErrors: { departmentSummaries: boolean; warnings: boolean };
}

export interface GetDashboardSummaryInput {
  companyId: string;
  /** Whether the caller may see inactive-record counts and data-quality warnings — docs/DASHBOARD_METRICS.md's per-metric "HR_EDITOR/ADMIN only" rows. */
  canSeeManagementDetails: boolean;
  /** Injectable for deterministic tests; defaults to the real current time. */
  now?: Date;
}

function toRow(row: DepartmentSummaryRow): DashboardDepartmentRow {
  return {
    id: row.department.id,
    name: row.department.name,
    code: row.department.code,
    color: row.department.color,
    status: row.department.status,
    activePositionCount: row.activePositionCount,
    occupiedPositionCount: row.occupiedPositionCount,
    vacantPositionCount: row.vacantPositionCount,
    plannedPositionCount: row.plannedPositionCount,
    activeAssignedEmployeeCount: row.activeAssignedEmployeeCount,
    // Unassigned employees are never attributable to a department (an
    // Employee has no departmentId; department is only derivable through
    // an active position assignment) — always false, documented rather
    // than silently omitted, per docs/PROJECT_SPEC.md Step 4 rule 6.
    activeUnassignedAttributed: false,
    maxOrganizationalLevel: row.maxOrganizationalLevel,
    childDepartmentCount: row.childDepartmentCount,
  };
}

/**
 * Assembles the whole read-only Company Overview payload. Every number
 * traces to docs/DASHBOARD_METRICS.md. Independent sections
 * (department summaries, data-quality warnings) are computed in their
 * own try/catch so one failing section never blanks the rest of the
 * dashboard (docs/DASHBOARD_METRICS.md §J "partial-section failure").
 */
export async function getDashboardSummary(
  input: GetDashboardSummaryInput
): Promise<DashboardSummary> {
  const now = input.now ?? new Date();
  const { companyId, canSeeManagementDetails } = input;

  const company = await findCompanyById(companyId);
  if (!company) throw new NotFoundError("Company", companyId);

  const [
    departmentCounts,
    positionCounts,
    occupiedActive,
    employeeCounts,
    activeAssigned,
    assignmentCounts,
    eligibleActive,
    occupiedEligible,
    hierarchySnapshot,
    rootRow,
    multiOccupantPositions,
    multiPrimaryEmployees,
  ] = await Promise.all([
    getDepartmentCounts(companyId),
    getPositionCounts(companyId),
    countOccupiedActivePositions(companyId, now),
    getEmployeeCounts(companyId),
    countActiveAssignedEmployees(companyId, now),
    getAssignmentCounts(companyId, now),
    countEligibleActivePositions(companyId),
    countOccupiedEligibleActivePositions(companyId, now),
    getPositionHierarchySnapshot(companyId),
    findRootPositionRow(companyId),
    findPositionsWithMultipleEffectiveOccupants(companyId, now),
    findEmployeesWithMultipleEffectiveAssignments(companyId, now),
  ]);

  const integrity = detectHierarchyIntegrityWarnings(hierarchySnapshot);
  const activeSnapshot = hierarchySnapshot.filter((p) => p.status === "ACTIVE");

  const vacancyRate = calculateVacancyRate(eligibleActive - occupiedEligible, eligibleActive);

  let departmentSummaries: DashboardDepartmentRow[] | null = null;
  let departmentSummariesFailed = false;
  try {
    const rows = await buildDepartmentSummaries(companyId, now);
    departmentSummaries = rows
      .filter((row) => canSeeManagementDetails || row.department.status === "ACTIVE")
      .map(toRow);
  } catch {
    departmentSummariesFailed = true;
  }

  let warnings: DashboardWarning[] | null = null;
  let warningsFailed = false;
  if (canSeeManagementDetails) {
    try {
      warnings = await buildWarnings({
        companyId,
        now,
        rootRow,
        integrity,
        activeUnassignedCount: employeeCounts.active - activeAssigned,
        multiOccupantPositions,
        multiPrimaryEmployees,
      });
    } catch {
      warningsFailed = true;
    }
  }

  return {
    company: {
      name: company.name,
      code: company.code,
      timezone: company.timezone,
      effectiveDate: now.toISOString().slice(0, 10),
      lastRefreshed: now.toISOString(),
    },
    departments: {
      totalActive: departmentCounts.totalActive,
      totalInactive: canSeeManagementDetails ? departmentCounts.totalInactive : null,
      topLevelActive: departmentCounts.topLevelActive,
      nestedActive: departmentCounts.nestedActive,
    },
    positions: {
      totalActive: positionCounts.totalActive,
      occupied: occupiedActive,
      vacant: positionCounts.totalActive - occupiedActive,
      planned: positionCounts.planned,
      inactive: canSeeManagementDetails ? positionCounts.inactive : null,
      root: rootRow
        ? {
            id: rootRow.id,
            title: rootRow.title,
            status: rootRow.status,
            isActive: rootRow.status === "ACTIVE",
          }
        : null,
      maxLevel: findMaxLevel(activeSnapshot),
      levelDistribution: buildLevelDistribution(activeSnapshot),
      disconnectedActiveCount: integrity.disconnectedActivePositionIds.length,
    },
    employees: {
      active: employeeCounts.active,
      activeAssigned,
      activeUnassigned: employeeCounts.active - activeAssigned,
      inactiveOrTerminated: canSeeManagementDetails ? employeeCounts.inactiveOrTerminated : null,
    },
    assignments: {
      currentPrimary: assignmentCounts.currentPrimary,
      future: canSeeManagementDetails ? assignmentCounts.future : null,
      multiOccupantPositionCount: multiOccupantPositions.length,
      multiPrimaryEmployeeCount: multiPrimaryEmployees.length,
    },
    vacancyRate,
    departmentSummaries,
    warnings,
    sectionErrors: { departmentSummaries: departmentSummariesFailed, warnings: warningsFailed },
  };
}

async function buildWarnings(args: {
  companyId: string;
  now: Date;
  rootRow: { id: string; title: string; status: string } | null;
  integrity: ReturnType<typeof detectHierarchyIntegrityWarnings>;
  activeUnassignedCount: number;
  multiOccupantPositions: string[];
  multiPrimaryEmployees: string[];
}): Promise<DashboardWarning[]> {
  const {
    companyId,
    now,
    rootRow,
    integrity,
    activeUnassignedCount,
    multiOccupantPositions,
    multiPrimaryEmployees,
  } = args;

  const [inactiveDeptPositions, inactiveEmployeeAssignments, inactivePositionAssignments] =
    await Promise.all([
      findActivePositionsInInactiveDepartments(companyId),
      findAssignmentsWithInactiveEmployee(companyId, now),
      findAssignmentsWithInactivePosition(companyId, now),
    ]);

  const warnings: DashboardWarning[] = [];

  if (rootRow === null || rootRow.status !== "ACTIVE") {
    warnings.push({
      id: "no-active-root",
      title: "No active root position",
      description:
        rootRow === null
          ? "This company has no positions yet, so there is no root position."
          : `The root position ("${rootRow.title}") is not Active — it is ${rootRow.status}.`,
      count: 1,
      link: rootRow
        ? {
            href: `/positions?search=${encodeURIComponent(rootRow.title)}`,
            label: "View root position",
          }
        : undefined,
    });
  }

  if (integrity.extraRootIds.length > 0) {
    warnings.push({
      id: "multiple-roots",
      title: "More than one root position",
      description: "More than one position has no primary manager. This should never be possible.",
      count: integrity.extraRootIds.length + 1,
    });
  }

  if (integrity.cycleActivePositionIds.length > 0) {
    warnings.push({
      id: "hierarchy-cycle",
      title: "Position hierarchy cycle detected",
      description: "One or more active positions form a reporting cycle (corrupted data).",
      count: integrity.cycleActivePositionIds.length,
      link: { href: "/positions", label: "View positions" },
    });
  }

  if (integrity.disconnectedActivePositionIds.length > 0) {
    warnings.push({
      id: "disconnected-position",
      title: "Disconnected active position",
      description:
        "One or more active positions cannot be traced up to the company's root position.",
      count: integrity.disconnectedActivePositionIds.length,
      link: { href: "/positions", label: "View positions" },
    });
  }

  if (inactiveDeptPositions.length > 0) {
    warnings.push({
      id: "active-position-inactive-department",
      title: "Active position in an inactive department",
      description: "One or more active positions belong to a department that has been archived.",
      count: inactiveDeptPositions.length,
      link: { href: "/positions", label: "View positions" },
    });
  }

  if (inactiveEmployeeAssignments.length > 0) {
    warnings.push({
      id: "assignment-inactive-employee",
      title: "Active assignment linked to an inactive employee",
      description:
        "One or more current position assignments belong to an employee who is not Active.",
      count: inactiveEmployeeAssignments.length,
      link: { href: "/employees", label: "View employees" },
    });
  }

  if (inactivePositionAssignments.length > 0) {
    warnings.push({
      id: "assignment-inactive-position",
      title: "Active assignment linked to an inactive position",
      description:
        "One or more current position assignments are attached to a position that is Inactive.",
      count: inactivePositionAssignments.length,
      link: { href: "/positions", label: "View positions" },
    });
  }

  if (multiOccupantPositions.length > 0) {
    warnings.push({
      id: "multiple-occupants",
      title: "Multiple effective occupants for one position",
      description:
        "One or more positions have more than one currently-effective primary assignment.",
      count: multiOccupantPositions.length,
      link: { href: "/positions", label: "View positions" },
    });
  }

  if (multiPrimaryEmployees.length > 0) {
    warnings.push({
      id: "multiple-primary-assignments",
      title: "Employee with multiple effective primary assignments",
      description:
        "One or more employees hold more than one currently-effective primary assignment.",
      count: multiPrimaryEmployees.length,
      link: { href: "/employees", label: "View employees" },
    });
  }

  if (activeUnassignedCount > 0) {
    warnings.push({
      id: "active-employee-without-position",
      title: "Active employees without a position",
      description: "One or more active employees have no current position assignment.",
      count: activeUnassignedCount,
      link: { href: "/employees?assignment=unassigned", label: "View unassigned employees" },
    });
  }

  return warnings;
}
