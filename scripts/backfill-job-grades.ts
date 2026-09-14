/**
 * One-off job-grade backfill.
 *
 * The organogram shows only positions at or above a job grade (L7 by
 * default — docs/DECISIONS.md §2b, D2), and it reads the STORED grade,
 * never the title. A company whose positions were imported without grades
 * therefore renders an almost-empty chart, correctly: the data does not
 * yet say who is leadership.
 *
 * This script closes that gap once, deliberately, and under review:
 *
 *   1. Ensures the L2..L18 scale exists for the company.
 *   2. For every position that has NO grade, infers one from its title
 *      (lib/domain/job-grade-mapping.ts) and assigns it.
 *
 * It never changes a grade that is already set — an HR-maintained value
 * always wins over an inferred one. Titles it cannot map are listed
 * rather than guessed at, so somebody can set those by hand.
 *
 * DRY RUN BY DEFAULT. Nothing is written without `--apply`.
 *
 * Usage:
 *   npx tsx scripts/backfill-job-grades.ts --company DEV-LOCAL
 *   npx tsx scripts/backfill-job-grades.ts --company DEV-LOCAL --apply
 */
import { PrismaClient } from "@prisma/client";

import { inferGradeCodeFromTitle, JOB_GRADE_SCALE } from "../lib/domain/job-grade-mapping";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const companyCode = arg("company");
  const apply = process.argv.includes("--apply");

  if (!companyCode) {
    console.error("Usage: npx tsx scripts/backfill-job-grades.ts --company <CODE> [--apply]");
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient();
  try {
    const company = await prisma.company.findUnique({ where: { code: companyCode } });
    if (!company) {
      console.error(`No company with code "${companyCode}".`);
      process.exitCode = 1;
      return;
    }

    console.log(`Company: ${company.name} (${company.code})`);
    console.log(apply ? "Mode: APPLY — changes will be written.\n" : "Mode: DRY RUN.\n");

    // --- 1. The scale ---------------------------------------------------
    const existing = await prisma.jobGrade.findMany({ where: { companyId: company.id } });
    const missing = JOB_GRADE_SCALE.filter((g) => !existing.some((e) => e.code === g.code));
    console.log(`Job grades: ${existing.length} present, ${missing.length} to create.`);
    if (apply) {
      for (const grade of missing) {
        await prisma.jobGrade.create({
          data: {
            companyId: company.id,
            code: grade.code,
            name: grade.name,
            displayOrder: grade.level,
            status: "ACTIVE",
          },
        });
      }
    }

    const gradeIdByCode = new Map<string, string>(existing.map((g) => [g.code, g.id]));
    if (apply) {
      const all = await prisma.jobGrade.findMany({ where: { companyId: company.id } });
      gradeIdByCode.clear();
      for (const g of all) gradeIdByCode.set(g.code, g.id);
    } else {
      // In a dry run the missing grades do not exist yet, so record their
      // codes as resolvable rather than reporting every position as
      // unmappable for a reason that `--apply` would have fixed.
      for (const grade of missing) gradeIdByCode.set(grade.code, "(would be created)");
    }

    // --- 2. The positions -----------------------------------------------
    const positions = await prisma.position.findMany({
      where: { companyId: company.id, jobGradeId: null },
      select: { id: true, positionCode: true, title: true },
      orderBy: { positionCode: "asc" },
    });

    console.log(`Positions with no grade: ${positions.length}\n`);

    const planned: { code: string; title: string; grade: string }[] = [];
    const unmapped: { code: string; title: string }[] = [];

    for (const position of positions) {
      const inferred = inferGradeCodeFromTitle(position.title);
      const gradeId = inferred ? gradeIdByCode.get(inferred) : undefined;
      if (!inferred || !gradeId) {
        unmapped.push({ code: position.positionCode, title: position.title });
        continue;
      }
      planned.push({ code: position.positionCode, title: position.title, grade: inferred });
      if (apply) {
        await prisma.position.update({ where: { id: position.id }, data: { jobGradeId: gradeId } });
      }
    }

    const byGrade = new Map<string, number>();
    for (const row of planned) byGrade.set(row.grade, (byGrade.get(row.grade) ?? 0) + 1);
    console.log(`${apply ? "Assigned" : "Would assign"} a grade to ${planned.length} position(s):`);
    for (const grade of JOB_GRADE_SCALE) {
      const count = byGrade.get(grade.code);
      if (count)
        console.log(`  ${grade.code.padEnd(4)} ${String(count).padStart(4)}  ${grade.name}`);
    }

    if (unmapped.length > 0) {
      console.log(
        `\n${unmapped.length} title(s) could not be mapped and were left with no grade — set these by hand in Positions:`
      );
      for (const row of unmapped) console.log(`  ${row.code.padEnd(12)} ${row.title}`);
    }

    if (!apply) {
      console.log("\nNothing was written. Re-run with --apply to commit these changes.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
