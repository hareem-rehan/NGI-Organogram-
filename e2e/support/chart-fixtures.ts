/**
 * Chart-visibility fixtures for the organogram E2E specs.
 *
 * Since the Demo 1 stakeholder feedback the organogram draws only
 * positions that are graded at or above the leadership threshold AND
 * occupied (docs/DECISIONS.md §2b). A spec that creates bare positions
 * through the UI therefore builds a hierarchy the chart correctly
 * declines to draw.
 *
 * Rather than adding a dozen more UI steps per spec (job grade pickers
 * and employee-assignment dialogs, both already covered end-to-end by
 * positions.spec.ts and employees.spec.ts), these helpers set the two
 * fields directly, the same way seed-session.ts already creates the
 * Company/User/Session rows directly. The specs stay about the CHART.
 *
 * Every helper is scoped to one company id and guarded by the same
 * assertSafeTestDatabaseUrl() as the rest of the E2E support layer.
 */
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/db/test-guard";
import { JOB_GRADE_SCALE } from "../../lib/domain/job-grade-mapping";

async function withPrisma<T>(fn: (prisma: PrismaClient) => Promise<T>): Promise<T> {
  assertSafeTestDatabaseUrl(process.env.DATABASE_URL);
  const prisma = new PrismaClient();
  try {
    return await fn(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

/** Creates the company's L2..L18 scale, exactly as scripts/backfill-job-grades.ts would. */
export async function seedJobGradeScale(companyId: string): Promise<void> {
  await withPrisma(async (prisma) => {
    for (const grade of JOB_GRADE_SCALE) {
      await prisma.jobGrade.upsert({
        where: { companyId_code: { companyId, code: grade.code } },
        update: {},
        create: {
          companyId,
          code: grade.code,
          name: grade.name,
          displayOrder: grade.level,
          status: "ACTIVE",
        },
      });
    }
  });
}

/** Sets one grade on the named position codes. The scale must already exist. */
export async function gradePositions(
  companyId: string,
  gradeCode: string,
  positionTitles: readonly string[]
): Promise<void> {
  await withPrisma(async (prisma) => {
    const grade = await prisma.jobGrade.findUnique({
      where: { companyId_code: { companyId, code: gradeCode } },
    });
    if (!grade) throw new Error(`Grade ${gradeCode} does not exist for company ${companyId}.`);
    // Matched by TITLE, not code: position codes are auto-generated and
    // hidden now, so a test knows a position by the title it typed.
    await prisma.position.updateMany({
      where: { companyId, title: { in: [...positionTitles] } },
      data: { jobGradeId: grade.id },
    });
  });
}

/**
 * Creates an employee and gives them an open-ended primary assignment to
 * the named position, so the chart treats it as occupied.
 */
export async function occupyPosition(
  companyId: string,
  positionTitle: string,
  occupant: { firstName: string; lastName: string }
): Promise<void> {
  await withPrisma(async (prisma) => {
    const position = await prisma.position.findFirst({
      where: { companyId, title: positionTitle },
    });
    if (!position) throw new Error(`Position "${positionTitle}" does not exist.`);

    const suffix = randomBytes(4).toString("hex");
    const employee = await prisma.employee.create({
      data: {
        companyId,
        employeeCode: `E2E-OCC-${suffix}`,
        firstName: occupant.firstName,
        lastName: occupant.lastName,
        workEmail: `e2e-occ-${suffix}@e2e-test.invalid`,
      },
    });
    await prisma.positionAssignment.create({
      data: {
        companyId,
        positionId: position.id,
        employeeId: employee.id,
        isPrimary: true,
        startDate: new Date("2024-01-01"),
        endDate: null,
      },
    });
  });
}
