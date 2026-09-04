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
  overrides: { code?: string; name?: string } = {}
) {
  return testPrisma.jobGrade.create({
    data: {
      companyId,
      code: overrides.code ?? unique("GRADE"),
      name: overrides.name ?? "Fixture Grade",
    },
  });
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
