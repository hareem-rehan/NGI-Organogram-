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
 * Finds a DEPARTMENT's level for this code, creating it if it does not
 * exist yet — and setting/updating its name.
 *
 * Levels are per-department (docs/DECISIONS.md): the code and its numeric
 * rank (L7 = 7) are universal, but the NAME belongs to one department, so
 * Engineering's L7 can be "Principal Engineer" and HR's L7 "HR Lead". A
 * position picks a level for its own department, and the first time that
 * department uses a level this creates it — named from the picker, or from
 * the standard scale when the caller passes no name. Passing a name also
 * updates it, so refining a department's level name while adding a
 * position keeps that department's level in sync.
 *
 * Only codes on the known scale are accepted. An arbitrary string is
 * rejected rather than creating a junk level that would pollute the picker
 * and every level comparison.
 *
 * `upsert` on the (companyId, departmentId, code) unique key makes it
 * race-safe: two positions created at once at the same new level for the
 * same department do not create two grades.
 */
export async function ensureJobGradeByCode(
  companyId: string,
  departmentId: string,
  rawCode: string,
  name: string | null | undefined,
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

  const trimmed = name?.trim();
  const finalName = trimmed && trimmed.length > 0 ? trimmed : scale.name;

  return db.jobGrade.upsert({
    where: { companyId_departmentId_code: { companyId, departmentId, code } },
    // A provided name keeps the department's level name current; without
    // one, an existing level is left untouched.
    update: trimmed && trimmed.length > 0 ? { name: finalName } : {},
    create: {
      companyId,
      departmentId,
      code,
      name: finalName,
      displayOrder: scale.level,
      status: "ACTIVE",
    },
  });
}
