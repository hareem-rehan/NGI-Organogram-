import "server-only";
import type { JobGrade } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { withTransaction } from "@/lib/db/transaction";
import type { DbClient } from "@/lib/repositories/types";
import { JOB_GRADE_SCALE } from "@/lib/domain/job-grade-mapping";
import { ConflictError, DomainValidationError } from "@/lib/domain/errors";
import { recordAuditEvent, type AuditActor } from "@/lib/services/audit.service";

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

export interface ProvisionStandardLevelsResult {
  created: JobGrade[];
  alreadyExisted: number;
}

/**
 * One-click bootstrap of the company's level scale.
 *
 * A company starts with no levels (job grades). Positions and the career
 * framework both pick a level from the ones that exist, so a brand-new (or
 * freshly-wiped) company has an empty Level picker and no way to create the
 * first level from the UI — the seed was previously the only maker of
 * grades. This provisions the whole standard scale (`JOB_GRADE_SCALE`,
 * L2..L18) as COMPANY-WIDE levels (departmentId = null), exactly the shape
 * the seed used, so both the Career Framework and the Position form pickers
 * fill immediately.
 *
 * Idempotent: any scale code that already exists as a company-wide grade is
 * left untouched and simply not re-created, so the button is safe to press
 * again (it only ever tops up what is missing). The whole thing runs in one
 * transaction with a single audit event; a concurrent double-submit that
 * races past the existence check trips the partial unique index and rolls
 * the whole thing back as a friendly conflict rather than half-creating.
 *
 * The scale is generic level nomenclature (Trainee..C-Suite), not employee
 * data — CLAUDE.md §1.11 is unaffected.
 */
export async function provisionStandardLevels(
  companyId: string,
  actor: AuditActor,
  db: DbClient = prisma
): Promise<ProvisionStandardLevelsResult> {
  return withTransaction(db, async (tx) => {
    const existing = await tx.jobGrade.findMany({
      where: { companyId, departmentId: null },
      select: { code: true },
    });
    const existingCodes = new Set(existing.map((g) => g.code));

    const created: JobGrade[] = [];
    try {
      for (const scale of JOB_GRADE_SCALE) {
        if (existingCodes.has(scale.code)) continue;
        created.push(
          await tx.jobGrade.create({
            data: {
              companyId,
              departmentId: null,
              code: scale.code,
              name: scale.name,
              displayOrder: scale.level,
              status: "ACTIVE",
            },
          })
        );
      }
    } catch (error) {
      if (
        error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        // A racing second submit created a code between our existence check
        // and this insert. The transaction is already doomed; surface a
        // friendly conflict instead of a raw Prisma error.
        throw new ConflictError("Standard levels are already set up for this company.");
      }
      throw error;
    }

    if (created.length > 0) {
      await recordAuditEvent(
        {
          companyId,
          actor,
          action: "CREATED",
          category: "COMPANY_SETTINGS",
          entityType: "JobGrade",
          entityDisplayReference: `Standard level scale (${created.length} level${
            created.length === 1 ? "" : "s"
          }: ${created[0]!.code}–${created[created.length - 1]!.code})`,
          metadata: { codes: created.map((g) => g.code) },
        },
        tx
      );
    }

    return { created, alreadyExisted: existingCodes.size };
  });
}
