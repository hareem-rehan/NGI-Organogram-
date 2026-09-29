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
): Promise<{ id: string; departmentId: string; primaryReportsToPositionId: string | null }> {
  assertSafeTestDatabaseUrl(process.env.DATABASE_URL);
  const prisma = new PrismaClient();
  try {
    return await prisma.position.findFirstOrThrow({
      where: { companyId, title },
      select: { id: true, departmentId: true, primaryReportsToPositionId: true },
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
