import { describe, expect, it } from "vitest";

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
} from "@/lib/repositories/dashboard.repository";
import { getDashboardSummary } from "@/lib/services/dashboard.service";
import { testPrisma } from "./setup";
import {
  makeChildPosition,
  makeCompany,
  makeDepartment,
  makeEmployee,
  makeRootPosition,
} from "./fixtures";

async function assign(
  companyId: string,
  employeeId: string,
  positionId: string,
  startDate: Date,
  endDate: Date | null = null
) {
  return testPrisma.positionAssignment.create({
    data: { companyId, employeeId, positionId, isPrimary: true, startDate, endDate },
  });
}

describe("Dashboard repository — company scoping", () => {
  it("every count is scoped to the requesting company only", async () => {
    const company = await makeCompany();
    const other = await makeCompany();
    await makeDepartment(company.id);
    await makeDepartment(other.id);
    await makeDepartment(other.id);

    const mine = await getDepartmentCounts(company.id);
    const theirs = await getDepartmentCounts(other.id);
    expect(mine.totalActive).toBe(1);
    expect(theirs.totalActive).toBe(2);
  });
});

describe("Dashboard repository — position/department/employee counts", () => {
  it("counts active/planned/inactive positions correctly", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const root = await makeRootPosition(company.id, dept.id);
    const planned = await makeChildPosition(company.id, dept.id, root.id, 1);
    await testPrisma.position.update({ where: { id: planned.id }, data: { status: "PLANNED" } });
    const inactive = await makeChildPosition(company.id, dept.id, root.id, 1);
    await testPrisma.position.update({ where: { id: inactive.id }, data: { status: "INACTIVE" } });

    const counts = await getPositionCounts(company.id);
    expect(counts.totalActive).toBe(1);
    expect(counts.planned).toBe(1);
    expect(counts.inactive).toBe(1);
  });

  it("counts top-level vs nested active departments", async () => {
    const company = await makeCompany();
    const parent = await makeDepartment(company.id);
    await makeDepartment(company.id, { parentDepartmentId: parent.id });

    const counts = await getDepartmentCounts(company.id);
    expect(counts.topLevelActive).toBe(1);
    expect(counts.nestedActive).toBe(1);
  });

  it("counts active vs. transferred/terminated employees", async () => {
    const company = await makeCompany();
    await makeEmployee(company.id);
    const terminated = await makeEmployee(company.id);
    await testPrisma.employee.update({
      where: { id: terminated.id },
      data: { employmentStatus: "TERMINATED" },
    });

    const counts = await getEmployeeCounts(company.id);
    expect(counts.active).toBe(1);
    expect(counts.inactiveOrTerminated).toBe(1);
  });
});

describe("Dashboard repository — occupancy is effective-date-correct", () => {
  it("counts a currently-open assignment as occupied, and vacant with none", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const occupied = await makeRootPosition(company.id, dept.id);
    const vacant = await makeChildPosition(company.id, dept.id, occupied.id, 1);
    const employee = await makeEmployee(company.id);
    await assign(company.id, employee.id, occupied.id, new Date("2024-01-01"));

    const now = new Date();
    expect(await countOccupiedActivePositions(company.id, now)).toBe(1);
    const counts = await getPositionCounts(company.id);
    expect(counts.totalActive).toBe(2);
    void vacant;
  });

  it("does not count a historical (ended) assignment as currently occupied", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const position = await makeRootPosition(company.id, dept.id);
    const employee = await makeEmployee(company.id);
    await assign(
      company.id,
      employee.id,
      position.id,
      new Date("2020-01-01"),
      new Date("2020-06-01")
    );

    expect(await countOccupiedActivePositions(company.id, new Date())).toBe(0);
  });

  it("does not count a future-dated assignment as currently occupied", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const position = await makeRootPosition(company.id, dept.id);
    const employee = await makeEmployee(company.id);
    const farFuture = new Date();
    farFuture.setFullYear(farFuture.getFullYear() + 1);
    await assign(company.id, employee.id, position.id, farFuture);

    expect(await countOccupiedActivePositions(company.id, new Date())).toBe(0);
  });

  it("treats the assignment's own end date as already vacant (exclusive end, docs/DECISIONS.md A18)", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const position = await makeRootPosition(company.id, dept.id);
    const employee = await makeEmployee(company.id);
    const endDate = new Date("2024-06-01");
    await assign(company.id, employee.id, position.id, new Date("2024-01-01"), endDate);

    expect(await countOccupiedActivePositions(company.id, endDate)).toBe(0);
  });

  it("active assigned/unassigned employee counts are effective-date-correct", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const position = await makeRootPosition(company.id, dept.id);
    const assignedEmployee = await makeEmployee(company.id);
    await makeEmployee(company.id); // unassigned
    await assign(company.id, assignedEmployee.id, position.id, new Date("2024-01-01"));

    const assigned = await countActiveAssignedEmployees(company.id, new Date());
    const total = await getEmployeeCounts(company.id);
    expect(assigned).toBe(1);
    expect(total.active - assigned).toBe(1);
  });
});

describe("Dashboard repository — vacancy-rate eligibility excludes inactive departments", () => {
  it("excludes positions in an inactive department from both eligible and occupied-eligible counts", async () => {
    const company = await makeCompany();
    const activeDept = await makeDepartment(company.id);
    const inactiveDept = await makeDepartment(company.id);
    await testPrisma.department.update({
      where: { id: inactiveDept.id },
      data: { status: "INACTIVE" },
    });
    const root = await makeRootPosition(company.id, activeDept.id);
    const inInactiveDept = await makeChildPosition(company.id, inactiveDept.id, root.id, 1, {
      positionCode: "IN-INACTIVE-DEPT",
    });
    const employee = await makeEmployee(company.id);
    await assign(company.id, employee.id, inInactiveDept.id, new Date("2024-01-01"));

    const eligible = await countEligibleActivePositions(company.id);
    const occupiedEligible = await countOccupiedEligibleActivePositions(company.id, new Date());
    expect(eligible).toBe(1);
    expect(occupiedEligible).toBe(0);
  });
});

describe("Dashboard repository — data-quality detection queries", () => {
  it("finds a position with more than one currently-effective primary assignment (corrupted data, direct write)", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const position = await makeRootPosition(company.id, dept.id);
    const employeeA = await makeEmployee(company.id);
    const employeeB = await makeEmployee(company.id);
    // Two finite, still-open, overlapping-by-date ranges — neither has
    // endDate IS NULL, so the DB partial unique index does not block
    // this (see docs/DASHBOARD_METRICS.md §H) — a genuine gap only
    // reachable by bypassing assignment.service.ts's overlap check.
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    await assign(company.id, employeeA.id, position.id, new Date("2024-01-01"), future);
    await assign(company.id, employeeB.id, position.id, new Date("2024-02-01"), future);

    const found = await findPositionsWithMultipleEffectiveOccupants(company.id, new Date());
    expect(found).toEqual([position.id]);
  });

  it("finds an employee with more than one currently-effective primary assignment (corrupted data, direct write)", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const positionA = await makeRootPosition(company.id, dept.id, { positionCode: "A" });
    const positionB = await makeChildPosition(company.id, dept.id, positionA.id, 1, {
      positionCode: "B",
    });
    const employee = await makeEmployee(company.id);
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    await assign(company.id, employee.id, positionA.id, new Date("2024-01-01"), future);
    await assign(company.id, employee.id, positionB.id, new Date("2024-02-01"), future);

    const found = await findEmployeesWithMultipleEffectiveAssignments(company.id, new Date());
    expect(found).toEqual([employee.id]);
  });

  it("finds an active position in an inactive department", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const position = await makeRootPosition(company.id, dept.id);
    await testPrisma.department.update({ where: { id: dept.id }, data: { status: "INACTIVE" } });

    expect(await findActivePositionsInInactiveDepartments(company.id)).toEqual([position.id]);
  });

  it("finds a currently-effective assignment linked to a non-ACTIVE employee (corrupted data, direct write)", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const position = await makeRootPosition(company.id, dept.id);
    const employee = await makeEmployee(company.id);
    await assign(company.id, employee.id, position.id, new Date("2024-01-01"));
    await testPrisma.employee.update({
      where: { id: employee.id },
      data: { employmentStatus: "TERMINATED" },
    });

    expect(await findAssignmentsWithInactiveEmployee(company.id, new Date())).toEqual([
      employee.id,
    ]);
  });

  it("finds a currently-effective assignment linked to an INACTIVE position (corrupted data, direct write)", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const position = await makeRootPosition(company.id, dept.id);
    const employee = await makeEmployee(company.id);
    await assign(company.id, employee.id, position.id, new Date("2024-01-01"));
    await testPrisma.position.update({ where: { id: position.id }, data: { status: "INACTIVE" } });

    expect(await findAssignmentsWithInactivePosition(company.id, new Date())).toEqual([
      position.id,
    ]);
  });

  it("reports no findings for a clean organization (no false positives)", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const root = await makeRootPosition(company.id, dept.id);
    const employee = await makeEmployee(company.id);
    await assign(company.id, employee.id, root.id, new Date("2024-01-01"));

    expect(await findPositionsWithMultipleEffectiveOccupants(company.id, new Date())).toEqual([]);
    expect(await findEmployeesWithMultipleEffectiveAssignments(company.id, new Date())).toEqual([]);
    expect(await findActivePositionsInInactiveDepartments(company.id)).toEqual([]);
    expect(await findAssignmentsWithInactiveEmployee(company.id, new Date())).toEqual([]);
    expect(await findAssignmentsWithInactivePosition(company.id, new Date())).toEqual([]);
  });
});

describe("Dashboard repository — hierarchy snapshot and root", () => {
  it("returns every position (any status) with the fields needed for graph derivations", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const root = await makeRootPosition(company.id, dept.id);
    await makeChildPosition(company.id, dept.id, root.id, 1);

    const snapshot = await getPositionHierarchySnapshot(company.id);
    expect(snapshot).toHaveLength(2);
    expect(snapshot.every((p) => typeof p.organizationalLevel === "number")).toBe(true);
  });

  it("finds the single root row regardless of status", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const root = await makeRootPosition(company.id, dept.id);
    await testPrisma.position.update({ where: { id: root.id }, data: { status: "INACTIVE" } });

    const found = await findRootPositionRow(company.id);
    expect(found?.id).toBe(root.id);
    expect(found?.status).toBe("INACTIVE");
  });

  it("returns null for a company with no positions at all", async () => {
    const company = await makeCompany();
    expect(await findRootPositionRow(company.id)).toBeNull();
  });
});

describe("Dashboard repository — department summaries", () => {
  it("computes per-department active/occupied/vacant/planned counts correctly, deterministically sorted", async () => {
    const company = await makeCompany();
    const deptA = await makeDepartment(company.id, { name: "Alpha", code: "A" });
    const deptB = await makeDepartment(company.id, { name: "Beta", code: "B" });
    const occupied = await makeRootPosition(company.id, deptA.id, { positionCode: "OCC" });
    await makeChildPosition(company.id, deptA.id, occupied.id, 1, { positionCode: "VAC" });
    const planned = await makeChildPosition(company.id, deptB.id, occupied.id, 1, {
      positionCode: "PLAN",
    });
    await testPrisma.position.update({ where: { id: planned.id }, data: { status: "PLANNED" } });
    const employee = await makeEmployee(company.id);
    await assign(company.id, employee.id, occupied.id, new Date("2024-01-01"));

    const rows = await buildDepartmentSummaries(company.id, new Date());
    const alpha = rows.find((r) => r.department.id === deptA.id)!;
    const beta = rows.find((r) => r.department.id === deptB.id)!;
    expect(alpha.activePositionCount).toBe(2);
    expect(alpha.occupiedPositionCount).toBe(1);
    expect(alpha.vacantPositionCount).toBe(1);
    expect(alpha.activeAssignedEmployeeCount).toBe(1);
    expect(beta.plannedPositionCount).toBe(1);
    expect(beta.activePositionCount).toBe(0);
  });

  it("counts child departments correctly", async () => {
    const company = await makeCompany();
    const parent = await makeDepartment(company.id);
    await makeDepartment(company.id, { parentDepartmentId: parent.id });
    await makeDepartment(company.id, { parentDepartmentId: parent.id });

    const rows = await buildDepartmentSummaries(company.id, new Date());
    expect(rows.find((r) => r.department.id === parent.id)?.childDepartmentCount).toBe(2);
  });
});

describe("Dashboard service — getDashboardSummary", () => {
  it("returns zero-valued, non-error metrics for a brand-new company with no data at all", async () => {
    const company = await makeCompany();

    const summary = await getDashboardSummary({
      companyId: company.id,
      canSeeManagementDetails: true,
    });

    expect(summary.departments.totalActive).toBe(0);
    expect(summary.positions.totalActive).toBe(0);
    expect(summary.positions.root).toBeNull();
    expect(summary.employees.active).toBe(0);
    expect(summary.vacancyRate.percent).toBeNull();
    expect(summary.warnings?.some((w) => w.id === "no-active-root")).toBe(true);
  });

  it("omits totalInactive/inactive/inactiveOrTerminated/warnings for a caller without management details", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    await makeRootPosition(company.id, dept.id);

    const summary = await getDashboardSummary({
      companyId: company.id,
      canSeeManagementDetails: false,
    });

    expect(summary.departments.totalInactive).toBeNull();
    expect(summary.positions.inactive).toBeNull();
    expect(summary.employees.inactiveOrTerminated).toBeNull();
    expect(summary.warnings).toBeNull();
  });

  it("includes warnings and inactive counts for a caller with management details", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    await makeRootPosition(company.id, dept.id);

    const summary = await getDashboardSummary({
      companyId: company.id,
      canSeeManagementDetails: true,
    });

    expect(summary.departments.totalInactive).toBe(0);
    expect(summary.positions.inactive).toBe(0);
    expect(summary.warnings).not.toBeNull();
  });

  it("detects a genuine hierarchy cycle created by a direct write (bypassing hierarchy.service.ts's cycle prevention) without crashing", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const positionA = await makeRootPosition(company.id, dept.id, { positionCode: "CYCLE-A" });
    const positionB = await makeChildPosition(company.id, dept.id, positionA.id, 1, {
      positionCode: "CYCLE-B",
    });
    // No DB constraint prevents an indirect cycle (docs/DOMAIN_MODEL.md
    // §7) — only lib/services/hierarchy.service.ts's application-layer
    // ancestor-chain walk does, and this bypasses it entirely to
    // simulate corrupted data reaching the dashboard.
    await testPrisma.position.update({
      where: { id: positionA.id },
      data: { primaryReportsToPositionId: positionB.id },
    });

    const summary = await getDashboardSummary({
      companyId: company.id,
      canSeeManagementDetails: true,
    });

    const cycleWarning = summary.warnings?.find((w) => w.id === "hierarchy-cycle");
    expect(cycleWarning).toBeDefined();
    expect(cycleWarning?.count).toBe(2);
    // The rest of the dashboard still returns real data — a corrupted
    // record never crashes the whole page.
    expect(summary.departments.totalActive).toBe(1);
  });

  it("never returns another company's data (company scoping end to end)", async () => {
    const company = await makeCompany({ name: "Mine" });
    const other = await makeCompany({ name: "Theirs" });
    await makeDepartment(other.id);
    await makeDepartment(other.id);

    const summary = await getDashboardSummary({
      companyId: company.id,
      canSeeManagementDetails: true,
    });
    expect(summary.company.name).toBe("Mine");
    expect(summary.departments.totalActive).toBe(0);
  });

  it("computes a correct, rounded vacancy rate", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const occupied = await makeRootPosition(company.id, dept.id, { positionCode: "OCC" });
    await makeChildPosition(company.id, dept.id, occupied.id, 1, { positionCode: "VAC1" });
    await makeChildPosition(company.id, dept.id, occupied.id, 1, { positionCode: "VAC2" });
    const employee = await makeEmployee(company.id);
    await assign(company.id, employee.id, occupied.id, new Date("2024-01-01"));

    const summary = await getDashboardSummary({
      companyId: company.id,
      canSeeManagementDetails: true,
    });
    expect(summary.vacancyRate).toEqual({ vacantCount: 2, eligibleCount: 3, percent: 67 });
  });

  it("throws NotFoundError for a company id that does not exist", async () => {
    const { NotFoundError } = await import("@/lib/domain/errors");
    await expect(
      getDashboardSummary({
        companyId: "00000000-0000-4000-8000-000000000000",
        canSeeManagementDetails: false,
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("Dashboard repository — future/current assignment counts", () => {
  it("distinguishes current-effective from future-dated primary assignments", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const positionA = await makeRootPosition(company.id, dept.id, { positionCode: "A" });
    const positionB = await makeChildPosition(company.id, dept.id, positionA.id, 1, {
      positionCode: "B",
    });
    const employeeA = await makeEmployee(company.id);
    const employeeB = await makeEmployee(company.id);
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    await assign(company.id, employeeA.id, positionA.id, new Date("2024-01-01"));
    await assign(company.id, employeeB.id, positionB.id, future);

    const counts = await getAssignmentCounts(company.id, new Date());
    expect(counts.currentPrimary).toBe(1);
    expect(counts.future).toBe(1);
  });
});
