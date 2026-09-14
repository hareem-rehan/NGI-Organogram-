import { testPrisma } from "./setup";

let counter = 0;
/** Deterministic-enough unique suffix within a single test run (no Date.now()/Math.random() dependency). */
function unique(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export async function makeCompany(overrides: { code?: string; name?: string } = {}) {
  return testPrisma.company.create({
    data: {
      code: overrides.code ?? unique("CO"),
      name: overrides.name ?? "Fixture Company",
    },
  });
}

export async function makeDepartment(
  companyId: string,
  overrides: { code?: string; name?: string; parentDepartmentId?: string | null } = {}
) {
  return testPrisma.department.create({
    data: {
      companyId,
      code: overrides.code ?? unique("DEPT"),
      name: overrides.name ?? "Fixture Department",
      parentDepartmentId: overrides.parentDepartmentId ?? null,
    },
  });
}

export async function makeJobGrade(
  companyId: string,
  overrides: { code?: string; name?: string; displayOrder?: number } = {}
) {
  return testPrisma.jobGrade.create({
    data: {
      companyId,
      code: overrides.code ?? unique("GRADE"),
      name: overrides.name ?? "Fixture Grade",
      displayOrder: overrides.displayOrder ?? null,
    },
  });
}

/**
 * A grade at or above the organogram's leadership threshold
 * (docs/DECISIONS.md §2b, D2 — L7 and above). Anything a test wants the
 * CHART to draw needs one: `getOrganogramChartData` filters on the stored
 * grade, so an ungraded fixture position is correctly treated as "not
 * known to be leadership" and left off the chart.
 */
export async function makeLeadershipJobGrade(companyId: string) {
  return makeJobGrade(companyId, {
    code: unique("L9"),
    name: "Fixture Leadership",
    displayOrder: 9,
  });
}

/**
 * Bulk-creates `count` positions that the organogram will actually draw:
 * graded at leadership level AND occupied (the chart hides vacancies).
 * Three bulk inserts rather than 3N round-trips, so a scale test still
 * runs in seconds.
 *
 * Returns the created position ids, in creation order.
 */
export async function makeOccupiedLeadershipPositions(args: {
  companyId: string;
  departmentId: string;
  parentPositionId: string;
  parentLevel: number;
  count: number;
  jobGradeId: string;
  titlePrefix?: string;
}): Promise<string[]> {
  const { companyId, departmentId, parentPositionId, parentLevel, count, jobGradeId } = args;
  const batch = unique("BULK");
  const titlePrefix = args.titlePrefix ?? "Direct Report";

  await testPrisma.position.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      companyId,
      departmentId,
      jobGradeId,
      title: `${titlePrefix} ${i}`,
      positionCode: `${batch}-${i}`,
      primaryReportsToPositionId: parentPositionId,
      organizationalLevel: parentLevel + 1,
    })),
  });
  await testPrisma.employee.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      companyId,
      employeeCode: `${batch}-EMP-${i}`,
      firstName: "Fixture",
      lastName: `Occupant ${i}`,
      workEmail: `${batch.toLowerCase()}-${i}@example.test`,
    })),
  });

  const positions = await testPrisma.position.findMany({
    where: { companyId, positionCode: { startsWith: `${batch}-` } },
    select: { id: true, positionCode: true },
  });
  const employees = await testPrisma.employee.findMany({
    where: { companyId, employeeCode: { startsWith: `${batch}-EMP-` } },
    select: { id: true, employeeCode: true },
  });
  const employeeByIndex = new Map(
    employees.map((e) => [Number(e.employeeCode.slice(`${batch}-EMP-`.length)), e.id])
  );
  const ordered = positions
    .map((p) => ({ id: p.id, index: Number(p.positionCode.slice(`${batch}-`.length)) }))
    .sort((a, b) => a.index - b.index);

  await testPrisma.positionAssignment.createMany({
    data: ordered.map(({ id, index }) => ({
      companyId,
      positionId: id,
      employeeId: employeeByIndex.get(index)!,
      isPrimary: true,
      startDate: new Date("2024-01-01"),
      endDate: null,
    })),
  });

  return ordered.map((o) => o.id);
}

export async function makeRootPosition(
  companyId: string,
  departmentId: string,
  overrides: { positionCode?: string; title?: string } = {}
) {
  return testPrisma.position.create({
    data: {
      companyId,
      departmentId,
      positionCode: overrides.positionCode ?? unique("POS-ROOT"),
      title: overrides.title ?? "Root Position",
      primaryReportsToPositionId: null,
      organizationalLevel: 1,
    },
  });
}

export async function makeChildPosition(
  companyId: string,
  departmentId: string,
  parentPositionId: string,
  parentLevel: number,
  overrides: { positionCode?: string; title?: string } = {}
) {
  return testPrisma.position.create({
    data: {
      companyId,
      departmentId,
      positionCode: overrides.positionCode ?? unique("POS-CHILD"),
      title: overrides.title ?? "Child Position",
      primaryReportsToPositionId: parentPositionId,
      organizationalLevel: parentLevel + 1,
    },
  });
}

export async function makeUser(
  companyId: string,
  overrides: { email?: string; role?: "ADMIN" | "HR_EDITOR" | "VIEWER" } = {}
) {
  return testPrisma.user.create({
    data: {
      companyId,
      email: overrides.email ?? `${unique("user")}@example.test`,
      role: overrides.role ?? "HR_EDITOR",
      status: "ACTIVE",
    },
  });
}

export async function makeEmployee(
  companyId: string,
  overrides: {
    employeeCode?: string;
    firstName?: string;
    lastName?: string;
    workEmail?: string | null;
  } = {}
) {
  return testPrisma.employee.create({
    data: {
      companyId,
      employeeCode: overrides.employeeCode ?? unique("EMP"),
      firstName: overrides.firstName ?? "Fixture",
      lastName: overrides.lastName ?? "Employee",
      workEmail:
        overrides.workEmail === undefined
          ? `${unique("fixture")}@example.test`
          : overrides.workEmail,
    },
  });
}
