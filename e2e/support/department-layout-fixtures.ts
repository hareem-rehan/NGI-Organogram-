/**
 * A multi-department chart shaped like the stakeholder's reference
 * (visily-multicomponents): a CEO over several departments, where two of
 * them (Client Delivery Services and Engineering) end in WIDE fan-outs —
 * the shape that used to let one department's cards drift under its
 * neighbour's. Seeded directly (like chart-fixtures.ts) so the spec stays
 * about the LAYOUT. Synthetic titles only (CLAUDE.md §1.11).
 */
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/db/test-guard";
import { seedJobGradeScale } from "./chart-fixtures";

export interface DepartmentLayoutChart {
  /** Position ids per department name, CEO excluded. */
  positionIdsByDepartment: Record<string, string[]>;
}

export async function seedDepartmentLayoutChart(
  companyId: string,
  suffix: string
): Promise<DepartmentLayoutChart> {
  assertSafeTestDatabaseUrl(process.env.DATABASE_URL);
  await seedJobGradeScale(companyId);
  const prisma = new PrismaClient();
  try {
    const grade = await prisma.jobGrade.findFirstOrThrow({
      where: { companyId, code: "L15", departmentId: null },
    });
    const dept = (name: string, color: string) =>
      prisma.department.create({
        data: {
          companyId,
          name: `${name} ${suffix}`,
          code: `E2E-DL-${randomBytes(3).toString("hex")}`,
          color,
        },
      });
    const founder = await dept("Founder", "#6d28d9");
    const departments = {
      Marketing: await dept("Marketing", "#e8811a"),
      "Client Delivery Services": await dept("Client Delivery Services", "#3aa4e8"),
      Engineering: await dept("Engineering", "#4fae2f"),
    };

    const byDept: Record<string, string[]> = {};
    const make = async (
      departmentId: string,
      title: string,
      parentId: string | null,
      level: number
    ) => {
      const p = await prisma.position.create({
        data: {
          companyId,
          departmentId,
          jobGradeId: grade.id,
          title: `${title} ${suffix}`,
          positionCode: `E2E-DL-${randomBytes(3).toString("hex")}`,
          primaryReportsToPositionId: parentId,
          organizationalLevel: level,
        },
      });
      return p;
    };
    const ceo = await make(founder.id, "CEO", null, 1);

    for (const [name, department] of Object.entries(departments)) {
      byDept[name] = [];
      // A leadership chain of four under the CEO…
      let tip = ceo;
      for (let i = 0; i < 4; i++) {
        tip = await make(
          department.id,
          `${name} Lead ${i + 1}`,
          tip.id,
          tip.organizationalLevel + 1
        );
        byDept[name].push(tip.id);
      }
      // …then a wide fan-out for the two big departments.
      const fanOut = name === "Marketing" ? 0 : name === "Engineering" ? 6 : 4;
      for (let k = 0; k < fanOut; k++) {
        const head = await make(
          department.id,
          `${name} Director ${k + 1}`,
          tip.id,
          tip.organizationalLevel + 1
        );
        byDept[name].push(head.id);
        for (let j = 0; j < 2; j++) {
          const report = await make(
            department.id,
            `${name} Manager ${k + 1}.${j + 1}`,
            head.id,
            head.organizationalLevel + 1
          );
          byDept[name].push(report.id);
        }
      }
    }
    return { positionIdsByDepartment: byDept };
  } finally {
    await prisma.$disconnect();
  }
}

/** Reads one position (by exact title) for asserting a drag-and-drop move. */
export async function readPositionByTitle(
  companyId: string,
  title: string
): Promise<{
  id: string;
  departmentId: string;
  primaryReportsToPositionId: string | null;
  displayOrder: number | null;
}> {
  assertSafeTestDatabaseUrl(process.env.DATABASE_URL);
  const prisma = new PrismaClient();
  try {
    return await prisma.position.findFirstOrThrow({
      where: { companyId, title },
      select: {
        id: true,
        departmentId: true,
        primaryReportsToPositionId: true,
        displayOrder: true,
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

/** Department names in their saved left-to-right order (displayOrder, then name). */
export async function readDepartmentOrder(companyId: string): Promise<string[]> {
  assertSafeTestDatabaseUrl(process.env.DATABASE_URL);
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.department.findMany({
      where: { companyId },
      orderBy: [{ displayOrder: { sort: "asc", nulls: "last" } }, { name: "asc" }],
      select: { name: true },
    });
    return rows.map((r) => r.name);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * CEO → Client Delivery Services → two SUB-departments (Product, Project),
 * each with a manager and one report — the shape where a department box is
 * nested inside its parent department's box.
 */
export async function seedSubDepartmentChart(companyId: string, suffix: string): Promise<void> {
  assertSafeTestDatabaseUrl(process.env.DATABASE_URL);
  await seedJobGradeScale(companyId);
  const prisma = new PrismaClient();
  try {
    const grade = await prisma.jobGrade.findFirstOrThrow({
      where: { companyId, code: "L15", departmentId: null },
    });
    const dept = (name: string, parentDepartmentId: string | null = null) =>
      prisma.department.create({
        data: {
          companyId,
          name: `${name} ${suffix}`,
          code: `E2E-SD-${randomBytes(3).toString("hex")}`,
          color: "#3aa4e8",
          parentDepartmentId,
        },
      });
    const make = (departmentId: string, title: string, parentId: string | null, level: number) =>
      prisma.position.create({
        data: {
          companyId,
          departmentId,
          jobGradeId: grade.id,
          title: `${title} ${suffix}`,
          positionCode: `E2E-SD-${randomBytes(3).toString("hex")}`,
          primaryReportsToPositionId: parentId,
          organizationalLevel: level,
        },
      });

    const founder = await dept("Founder");
    const cds = await dept("Client Delivery Services");
    const ceo = await make(founder.id, "CEO", null, 1);
    const cdsHead = await make(cds.id, "CDS Head", ceo.id, 2);
    for (const name of ["Product", "Project"]) {
      const sub = await dept(name, cds.id);
      const manager = await make(sub.id, `${name} Manager`, cdsHead.id, 3);
      await make(sub.id, `${name} Analyst`, manager.id, 4);
    }
  } finally {
    await prisma.$disconnect();
  }
}

/** Saved card offsets (D38) for the company, keyed by chart node id. */
export async function readCardOffsetKeys(companyId: string): Promise<string[]> {
  assertSafeTestDatabaseUrl(process.env.DATABASE_URL);
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.organogramCardOffset.findMany({
      where: { companyId },
      select: { nodeKey: true },
    });
    return rows.map((r) => r.nodeKey).sort();
  } finally {
    await prisma.$disconnect();
  }
}

/** A department's id by exact name (for building `dept:<id>` chart keys). */
export async function readDepartmentId(companyId: string, name: string): Promise<string> {
  assertSafeTestDatabaseUrl(process.env.DATABASE_URL);
  const prisma = new PrismaClient();
  try {
    return (await prisma.department.findFirstOrThrow({ where: { companyId, name } })).id;
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * A head of HR whose reports sit in three sub-divisions (Branding, HR Ops,
 * Recruitment), each with one role under it — so the chart draws three
 * sub-division boxes side by side under the head (D55 reorder).
 */
export async function seedSubdivisionChart(companyId: string, suffix: string): Promise<void> {
  assertSafeTestDatabaseUrl(process.env.DATABASE_URL);
  await seedJobGradeScale(companyId);
  const prisma = new PrismaClient();
  try {
    const grade = await prisma.jobGrade.findFirstOrThrow({
      where: { companyId, code: "L15", departmentId: null },
    });
    const dept = (name: string) =>
      prisma.department.create({
        data: {
          companyId,
          name: `${name} ${suffix}`,
          code: `E2E-SV-${randomBytes(3).toString("hex")}`,
          color: "#f5c242",
        },
      });
    const founder = await dept("Founder");
    const hr = await dept("People");
    const make = (
      departmentId: string,
      title: string,
      parentId: string | null,
      level: number,
      jobFamilyId: string | null = null
    ) =>
      prisma.position.create({
        data: {
          companyId,
          departmentId,
          jobGradeId: grade.id,
          jobFamilyId,
          title: `${title} ${suffix}`,
          positionCode: `E2E-SV-${randomBytes(3).toString("hex")}`,
          primaryReportsToPositionId: parentId,
          organizationalLevel: level,
        },
      });
    const ceo = await make(founder.id, "CEO", null, 1);
    const head = await make(hr.id, "Head of People", ceo.id, 2);
    for (const name of ["Branding", "HR Ops", "Recruitment"]) {
      const family = await prisma.jobFamily.create({
        data: {
          companyId,
          departmentId: hr.id,
          name: `${name} ${suffix}`,
          code: `E2E-SV-${randomBytes(3).toString("hex")}`,
        },
      });
      const lead = await make(hr.id, `${name} Lead`, head.id, 3, family.id);
      await make(hr.id, `${name} Officer`, lead.id, 4, family.id);
    }
  } finally {
    await prisma.$disconnect();
  }
}

/** Sub-division names for the company, in their saved order (D55), then by name. */
export async function readSubdivisionOrder(companyId: string): Promise<string[]> {
  assertSafeTestDatabaseUrl(process.env.DATABASE_URL);
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.jobFamily.findMany({
      where: { companyId },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      select: { name: true },
    });
    return rows.map((r) => r.name);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * A head with two reports side by side: "Principal Engineer" held by five
 * people (D56) with a report under it, and a single-holder neighbour — for
 * the expandable names on a card (user request, 2026-10-19).
 */
export async function seedSharedPositionChart(companyId: string, suffix: string): Promise<void> {
  assertSafeTestDatabaseUrl(process.env.DATABASE_URL);
  await seedJobGradeScale(companyId);
  const prisma = new PrismaClient();
  try {
    const grade = await prisma.jobGrade.findFirstOrThrow({
      where: { companyId, code: "L15", departmentId: null },
    });
    const dept = await prisma.department.create({
      data: {
        companyId,
        name: `Platform ${suffix}`,
        code: `E2E-SP-${randomBytes(3).toString("hex")}`,
        color: "#7cc576",
      },
    });
    const make = (title: string, parentId: string | null, level: number) =>
      prisma.position.create({
        data: {
          companyId,
          departmentId: dept.id,
          jobGradeId: grade.id,
          title: `${title} ${suffix}`,
          positionCode: `E2E-SP-${randomBytes(3).toString("hex")}`,
          primaryReportsToPositionId: parentId,
          organizationalLevel: level,
        },
      });
    const head = await make("Platform Head", null, 1);
    const shared = await make("Principal Engineer", head.id, 2);
    const neighbour = await make("Staff Engineer", head.id, 2);
    await make("Senior Engineer", shared.id, 3);
    const people = [
      "Ghulam Nabi",
      "Waqas Ansari",
      "Zeeshan Rasheed",
      "Owais Hassan Zaidi",
      "Haris Ali",
    ];
    for (const [index, name] of [...people, "Sana Mir"].entries()) {
      const [firstName, ...rest] = name.split(" ");
      const employee = await prisma.employee.create({
        data: {
          companyId,
          employeeCode: `E2E-SP-${randomBytes(3).toString("hex")}`,
          firstName: firstName!,
          lastName: `${rest.join(" ")} ${suffix}`,
        },
      });
      await prisma.positionAssignment.create({
        data: {
          companyId,
          employeeId: employee.id,
          positionId: index < people.length ? shared.id : neighbour.id,
          isPrimary: true,
          startDate: new Date(Date.UTC(2024, 0, 1 + index)),
        },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}
