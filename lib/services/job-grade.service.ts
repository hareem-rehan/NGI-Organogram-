import "server-only";
import type { JobGrade } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import type { DbClient } from "@/lib/repositories/types";
import { JOB_GRADE_SCALE } from "@/lib/domain/job-grade-mapping";
import { DomainValidationError } from "@/lib/domain/errors";

const SCALE_BY_CODE = new Map(JOB_GRADE_SCALE.map((g) => [g.code, g] as const));

/** Trim and upper-case, so "l7", " L7 " and "L7" all resolve to the same grade. */
export function normalizeGradeCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Finds the company's job grade with this code, creating it from the
 * standard L2–L18 scale if it does not exist yet.
 *
 * This is what lets a position's level be chosen at creation time on a
 * company that has no grades set up. The dropdown offers the standard
 * scale (a constant, so it works against an empty database), and the
 * first time a level is actually picked, this creates the matching grade
 * row — name and numeric rank taken from the scale, so a hand-created
 * grade is identical to a seeded or imported one.
 *
 * Only codes on the known scale are accepted. An arbitrary string is
 * rejected rather than silently creating a junk grade that would then
 * pollute the dropdown and every level comparison.
 *
 * `upsert` on the (companyId, code) unique key makes it race-safe and
 * idempotent: two positions created at once with the same new level do
 * not create two grades or collide.
 */
export async function ensureJobGradeByCode(
  companyId: string,
  rawCode: string,
  db: DbClient = prisma
): Promise<JobGrade> {
  const code = normalizeGradeCode(rawCode);
  const scale = SCALE_BY_CODE.get(code);
  if (!scale) {
    const first = JOB_GRADE_SCALE[0]!.code;
    const last = JOB_GRADE_SCALE[JOB_GRADE_SCALE.length - 1]!.code;
    throw new DomainValidationError(
      `"${rawCode}" is not a recognized level. Choose one of ${first}–${last}.`
    );
  }

  return db.jobGrade.upsert({
    where: { companyId_code: { companyId, code } },
    update: {},
    create: {
      companyId,
      code,
      name: scale.name,
      displayOrder: scale.level,
      status: "ACTIVE",
    },
  });
}
