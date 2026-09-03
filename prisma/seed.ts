/**
 * Idempotent development seed. Safe to run repeatedly — every record is
 * upserted by its natural unique key, so re-running never creates
 * duplicates (docs/phase-reports/PHASE_02_DATABASE_AND_DOMAIN.md "Seed
 * Strategy").
 *
 * All names, emails, and codes below are entirely fictional — this is
 * NOT the reference organogram's real data, per CLAUDE.md §1.11 ("no
 * real employee data... in source, fixtures, seeds").
 *
 * BLOCKED IN PRODUCTION: refuses to run unless NODE_ENV is "development"
 * or "test". There is no override flag — if you need seed-like data in
 * another environment, that is a deliberate, separate decision this
 * script will not make for you.
 *
 * `runSeed(db)` takes an explicit PrismaClient so integration tests can
 * call it directly against the test database (see
 * tests/integration/seed.integration.test.ts) without spawning a
 * subprocess. The CLI entry point at the bottom of this file is the only
 * thing that constructs its own client and enforces the environment gate.
 */
import type { PrismaClient } from "@prisma/client";

export function assertSeedAllowed(env: string | undefined = process.env.NODE_ENV): void {
  if (env !== "development" && env !== "test") {
    throw new Error(
      `Refusing to seed: NODE_ENV is "${env}", but the seed script only runs when NODE_ENV is "development" or "test". ` +
        "This script is not a safe or supported way to populate a production database."
    );
  }
}

const COMPANY_CODE = "NORTHWIND-EXAMPLE";

export async function runSeed(db: PrismaClient) {
  async function upsertCompany() {
    return db.company.upsert({
      where: { code: COMPANY_CODE },
      update: {},
      create: {
        code: COMPANY_CODE,
        name: "Northwind Example Co.",
        legalName: "Northwind Example Co. (Fictional)",
        timezone: "UTC",
        status: "ACTIVE",
      },
    });
  }

  async function upsertDepartment(
    companyId: string,
    code: string,
    data: { name: string; color: string; parentDepartmentId?: string | null; displayOrder: number }
  ) {
    return db.department.upsert({
      where: { companyId_code: { companyId, code } },
      update: {},
      create: {
        companyId,
        code,
        name: data.name,
        color: data.color,
        parentDepartmentId: data.parentDepartmentId ?? null,
        displayOrder: data.displayOrder,
        status: "ACTIVE",
      },
    });
  }

  async function upsertJobGrade(
    companyId: string,
    code: string,
    data: { name: string; displayOrder: number }
  ) {
    return db.jobGrade.upsert({
      where: { companyId_code: { companyId, code } },
      update: {},
      create: {
        companyId,
        code,
        name: data.name,
        displayOrder: data.displayOrder,
        status: "ACTIVE",
      },
    });
  }

  interface SeedPositionInput {
    companyId: string;
    positionCode: string;
    title: string;
    departmentId: string;
    jobGradeId: string | null;
    primaryReportsToPositionId: string | null;
    organizationalLevel: number;
    status?: "PLANNED" | "ACTIVE" | "INACTIVE";
  }

  async function upsertPosition(input: SeedPositionInput) {
    return db.position.upsert({
      where: {
        companyId_positionCode: { companyId: input.companyId, positionCode: input.positionCode },
      },
      update: {},
      create: {
        companyId: input.companyId,
        positionCode: input.positionCode,
        title: input.title,
        departmentId: input.departmentId,
        jobGradeId: input.jobGradeId,
        primaryReportsToPositionId: input.primaryReportsToPositionId,
        organizationalLevel: input.organizationalLevel,
        status: input.status ?? "ACTIVE",
      },
    });
  }

  async function upsertEmployee(
    companyId: string,
    employeeCode: string,
    data: { firstName: string; lastName: string; workEmail: string; joiningDate: Date }
  ) {
    return db.employee.upsert({
      where: { companyId_employeeCode: { companyId, employeeCode } },
      update: {},
      create: {
        companyId,
        employeeCode,
        firstName: data.firstName,
        lastName: data.lastName,
        workEmail: data.workEmail,
        employmentStatus: "ACTIVE",
        joiningDate: data.joiningDate,
      },
    });
  }

  /** Assignments have no single natural unique key, so idempotency here means "does a row with this exact shape already exist?" — check first, create only if absent. */
  async function upsertAssignment(data: {
    companyId: string;
    employeeId: string;
    positionId: string;
    startDate: Date;
    endDate: Date | null;
  }) {
    const existing = await db.positionAssignment.findFirst({
      where: {
        companyId: data.companyId,
        employeeId: data.employeeId,
        positionId: data.positionId,
        startDate: data.startDate,
      },
    });
    if (existing) return existing;

    return db.positionAssignment.create({
      data: { ...data, isPrimary: true },
    });
  }

  const company = await upsertCompany();

  const [execDept, engDept, deliveryDept, peopleDept] = await Promise.all([
    upsertDepartment(company.id, "EXEC", { name: "Executive", color: "#2563eb", displayOrder: 1 }),
    upsertDepartment(company.id, "ENG", { name: "Engineering", color: "#16a34a", displayOrder: 2 }),
    upsertDepartment(company.id, "DELIVERY", {
      name: "Client Delivery",
      color: "#d97706",
      displayOrder: 3,
    }),
    upsertDepartment(company.id, "PEOPLE", {
      name: "People & Culture",
      color: "#7c3aed",
      displayOrder: 4,
    }),
  ]);

  // Nested department example: Platform Engineering is a child of Engineering.
  const platformDept = await upsertDepartment(company.id, "ENG-PLATFORM", {
    name: "Platform Engineering",
    color: "#16a34a",
    parentDepartmentId: engDept.id,
    displayOrder: 1,
  });

  const [l4, l5, l6] = await Promise.all([
    upsertJobGrade(company.id, "L4", { name: "Individual Contributor", displayOrder: 4 }),
    upsertJobGrade(company.id, "L5", { name: "Manager", displayOrder: 5 }),
    upsertJobGrade(company.id, "L6", { name: "Executive", displayOrder: 6 }),
  ]);

  // --- Positions -----------------------------------------------------
  const ceo = await upsertPosition({
    companyId: company.id,
    positionCode: "POS-CEO",
    title: "Chief Executive Officer",
    departmentId: execDept.id,
    jobGradeId: l6.id,
    primaryReportsToPositionId: null,
    organizationalLevel: 1,
  });

  const vpEngineering = await upsertPosition({
    companyId: company.id,
    positionCode: "POS-VP-ENG",
    title: "VP of Engineering",
    departmentId: engDept.id,
    jobGradeId: l6.id,
    primaryReportsToPositionId: ceo.id,
    organizationalLevel: 2,
  });

  const vpDelivery = await upsertPosition({
    companyId: company.id,
    positionCode: "POS-VP-DELIVERY",
    title: "VP of Client Delivery",
    departmentId: deliveryDept.id,
    jobGradeId: l6.id,
    primaryReportsToPositionId: ceo.id,
    organizationalLevel: 2,
  });

  // Vacant position: approved, active, but nobody assigned yet.
  const headOfPeople = await upsertPosition({
    companyId: company.id,
    positionCode: "POS-HEAD-PEOPLE",
    title: "Head of People & Culture",
    departmentId: peopleDept.id,
    jobGradeId: l5.id,
    primaryReportsToPositionId: ceo.id,
    organizationalLevel: 2,
  });

  const engManagerPlatform = await upsertPosition({
    companyId: company.id,
    positionCode: "POS-ENGMGR-PLATFORM",
    title: "Engineering Manager, Platform",
    departmentId: platformDept.id,
    jobGradeId: l5.id,
    primaryReportsToPositionId: vpEngineering.id,
    organizationalLevel: 3,
  });

  const seniorEngineer = await upsertPosition({
    companyId: company.id,
    positionCode: "POS-SR-ENGINEER",
    title: "Senior Software Engineer",
    departmentId: platformDept.id,
    jobGradeId: l4.id,
    primaryReportsToPositionId: engManagerPlatform.id,
    organizationalLevel: 4,
  });

  // Deep vertical branch: CEO -> VP Eng -> Eng Manager -> Sr Engineer -> Engineer (5 levels).
  const softwareEngineerDeep = await upsertPosition({
    companyId: company.id,
    positionCode: "POS-ENGINEER-DEEP",
    title: "Software Engineer",
    departmentId: platformDept.id,
    jobGradeId: l4.id,
    primaryReportsToPositionId: seniorEngineer.id,
    organizationalLevel: 5,
  });

  // Parallel sibling under the same manager as seniorEngineer.
  const softwareEngineer2 = await upsertPosition({
    companyId: company.id,
    positionCode: "POS-ENGINEER-2",
    title: "Software Engineer",
    departmentId: platformDept.id,
    jobGradeId: l4.id,
    primaryReportsToPositionId: engManagerPlatform.id,
    organizationalLevel: 4,
  });

  // Planned position: approved for the future, not yet active.
  const dataAnalyst = await upsertPosition({
    companyId: company.id,
    positionCode: "POS-DATA-ANALYST",
    title: "Data Analyst",
    departmentId: platformDept.id,
    jobGradeId: l4.id,
    primaryReportsToPositionId: engManagerPlatform.id,
    organizationalLevel: 4,
    status: "PLANNED",
  });

  // Client Delivery: two parallel sibling managers under the VP.
  const deliveryManagerA = await upsertPosition({
    companyId: company.id,
    positionCode: "POS-DELMGR-A",
    title: "Delivery Manager",
    departmentId: deliveryDept.id,
    jobGradeId: l5.id,
    primaryReportsToPositionId: vpDelivery.id,
    organizationalLevel: 3,
  });

  const deliveryManagerB = await upsertPosition({
    companyId: company.id,
    positionCode: "POS-DELMGR-B",
    title: "Delivery Manager",
    departmentId: deliveryDept.id,
    jobGradeId: l5.id,
    primaryReportsToPositionId: vpDelivery.id,
    organizationalLevel: 3,
  });

  const projectCoordinator = await upsertPosition({
    companyId: company.id,
    positionCode: "POS-PROJ-COORD",
    title: "Project Coordinator",
    departmentId: deliveryDept.id,
    jobGradeId: l4.id,
    primaryReportsToPositionId: deliveryManagerB.id,
    organizationalLevel: 4,
  });

  // --- Employees -------------------------------------------------------
  const amara = await upsertEmployee(company.id, "EMP-0001", {
    firstName: "Amara",
    lastName: "Chen",
    workEmail: "amara.chen@northwind-example.test",
    joiningDate: new Date("2020-01-15"),
  });
  const diego = await upsertEmployee(company.id, "EMP-0002", {
    firstName: "Diego",
    lastName: "Ramirez",
    workEmail: "diego.ramirez@northwind-example.test",
    joiningDate: new Date("2020-03-01"),
  });
  const priya = await upsertEmployee(company.id, "EMP-0003", {
    firstName: "Priya",
    lastName: "Natarajan",
    workEmail: "priya.natarajan@northwind-example.test",
    joiningDate: new Date("2020-06-10"),
  });
  const sofia = await upsertEmployee(company.id, "EMP-0004", {
    firstName: "Sofia",
    lastName: "Bianchi",
    workEmail: "sofia.bianchi@northwind-example.test",
    joiningDate: new Date("2021-02-01"),
  });
  const kwame = await upsertEmployee(company.id, "EMP-0005", {
    firstName: "Kwame",
    lastName: "Mensah",
    workEmail: "kwame.mensah@northwind-example.test",
    joiningDate: new Date("2021-07-15"),
  });
  const noah = await upsertEmployee(company.id, "EMP-0006", {
    firstName: "Noah",
    lastName: "Kimura",
    workEmail: "noah.kimura@northwind-example.test",
    joiningDate: new Date("2022-01-10"),
  });
  const liam = await upsertEmployee(company.id, "EMP-0007", {
    firstName: "Liam",
    lastName: "O'Connor",
    workEmail: "liam.oconnor@northwind-example.test",
    joiningDate: new Date("2023-02-01"),
  });
  const fatima = await upsertEmployee(company.id, "EMP-0008", {
    firstName: "Fatima",
    lastName: "Al-Sayed",
    workEmail: "fatima.alsayed@northwind-example.test",
    joiningDate: new Date("2021-09-01"),
  });
  const james = await upsertEmployee(company.id, "EMP-0009", {
    firstName: "James",
    lastName: "Okafor",
    workEmail: "james.okafor@northwind-example.test",
    joiningDate: new Date("2021-11-01"),
  });
  const elena = await upsertEmployee(company.id, "EMP-0010", {
    firstName: "Elena",
    lastName: "Petrova",
    workEmail: "elena.petrova@northwind-example.test",
    joiningDate: new Date("2022-04-01"),
  });

  // --- Assignments -------------------------------------------------------
  await upsertAssignment({
    companyId: company.id,
    employeeId: amara.id,
    positionId: ceo.id,
    startDate: new Date("2020-01-15"),
    endDate: null,
  });
  await upsertAssignment({
    companyId: company.id,
    employeeId: diego.id,
    positionId: vpEngineering.id,
    startDate: new Date("2020-03-01"),
    endDate: null,
  });
  await upsertAssignment({
    companyId: company.id,
    employeeId: priya.id,
    positionId: vpDelivery.id,
    startDate: new Date("2020-06-10"),
    endDate: null,
  });
  // headOfPeople intentionally has NO assignment — the vacant position.
  await upsertAssignment({
    companyId: company.id,
    employeeId: sofia.id,
    positionId: engManagerPlatform.id,
    startDate: new Date("2021-02-01"),
    endDate: null,
  });
  await upsertAssignment({
    companyId: company.id,
    employeeId: kwame.id,
    positionId: seniorEngineer.id,
    startDate: new Date("2021-07-15"),
    endDate: null,
  });
  await upsertAssignment({
    companyId: company.id,
    employeeId: noah.id,
    positionId: softwareEngineerDeep.id,
    startDate: new Date("2022-01-10"),
    endDate: null,
  });
  await upsertAssignment({
    companyId: company.id,
    employeeId: fatima.id,
    positionId: deliveryManagerA.id,
    startDate: new Date("2021-09-01"),
    endDate: null,
  });
  await upsertAssignment({
    companyId: company.id,
    employeeId: james.id,
    positionId: deliveryManagerB.id,
    startDate: new Date("2021-11-01"),
    endDate: null,
  });

  // Historical assignment: Elena held Software Engineer 2 before transferring
  // to Project Coordinator (docs/DOMAIN_MODEL.md's "employee transfer
  // preserves history" example, seeded as real data, not just tested).
  await upsertAssignment({
    companyId: company.id,
    employeeId: elena.id,
    positionId: softwareEngineer2.id,
    startDate: new Date("2022-04-01"),
    endDate: new Date("2023-01-31"),
  });
  await upsertAssignment({
    companyId: company.id,
    employeeId: liam.id,
    positionId: softwareEngineer2.id,
    startDate: new Date("2023-02-01"),
    endDate: null,
  });
  await upsertAssignment({
    companyId: company.id,
    employeeId: elena.id,
    positionId: projectCoordinator.id,
    startDate: new Date("2023-02-01"),
    endDate: null,
  });

  return {
    company,
    departments: { execDept, engDept, deliveryDept, peopleDept, platformDept },
    jobGrades: { l4, l5, l6 },
    positions: {
      ceo,
      vpEngineering,
      vpDelivery,
      headOfPeople,
      engManagerPlatform,
      seniorEngineer,
      softwareEngineerDeep,
      softwareEngineer2,
      dataAnalyst,
      deliveryManagerA,
      deliveryManagerB,
      projectCoordinator,
    },
    employees: { amara, diego, priya, sofia, kwame, noah, liam, fatima, james, elena },
  };
}

/* c8 ignore start -- CLI entry point, exercised manually and via `npm run db:seed`, not under unit/integration coverage */
async function runAsCli() {
  assertSeedAllowed();
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  try {
    const result = await runSeed(db);
    console.log(`Seed complete for company "${result.company.name}" (${result.company.code}).`);
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  runAsCli().catch((error: unknown) => {
    console.error("Seed failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
/* c8 ignore stop */
