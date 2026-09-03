import "server-only";
import crypto from "node:crypto";
import type { ImportJob, ImportMode, ImportType, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { withTransaction } from "@/lib/db/transaction";
import { DomainValidationError, NotFoundError, UnsafeMutationError } from "@/lib/domain/errors";
import { normalizeCode } from "@/lib/domain/normalize";
import {
  CsvFileError,
  decodeCsvBuffer,
  MAX_FILE_SIZE_BYTES,
  parseCsvFile,
} from "@/lib/domain/import/csv";
import {
  DEPARTMENT_REQUIRED_COLUMNS,
  validateDepartmentRows,
  type ExistingDepartmentSnapshot,
  type NormalizedDepartmentRow,
} from "@/lib/domain/import/department-import";
import {
  POSITION_REQUIRED_COLUMNS,
  validatePositionRows,
  type ExistingPositionSnapshot as ExistingPositionSnapshotForImport,
  type NormalizedPositionRow,
} from "@/lib/domain/import/position-import";
import {
  EMPLOYEE_REQUIRED_COLUMNS,
  validateEmployeeRows,
  type ExistingEmployeeSnapshot,
  type NormalizedEmployeeRow,
} from "@/lib/domain/import/employee-import";
import {
  ASSIGNMENT_REQUIRED_COLUMNS,
  validateAssignmentRows,
  type NormalizedAssignmentRow,
} from "@/lib/domain/import/assignment-import";
import {
  resolveFieldForWrite,
  type RowIssue,
  type RowPlanEntry,
  type ValidationOutcome,
} from "@/lib/domain/import/types";
import type { DbClient } from "@/lib/repositories/types";
import {
  createImportJob,
  createImportRowIssues,
  deleteImportRowIssues,
  findImportJobById,
  listAllEmployeesForCompany,
  listAllOpenAssignmentsForCompany,
  listImportJobsForCompany,
  listImportRowIssues,
  updateImportJob,
} from "@/lib/repositories/import.repository";
import { listDepartmentsForCompany } from "@/lib/repositories/department.repository";
import { listAllPositionsForCompany } from "@/lib/repositories/position.repository";
import { listJobGradesForCompany } from "@/lib/repositories/job-grade.repository";
import {
  archiveDepartment,
  createDepartment,
  moveDepartment,
  reactivateDepartment,
  updateDepartment,
} from "@/lib/services/department.service";
import {
  activatePosition,
  archivePosition,
  createPosition,
  movePosition,
  translateWriteError as translatePositionWriteError,
  updatePosition,
} from "@/lib/services/hierarchy.service";
import { translateWriteError as translateDepartmentWriteError } from "@/lib/services/department.service";
import {
  changeEmployeeStatus,
  createEmployee,
  translateWriteError as translateEmployeeWriteError,
  updateEmployee,
} from "@/lib/services/employee.service";
import {
  createAssignment,
  endAssignment,
  transferEmployee,
} from "@/lib/services/assignment.service";
import {
  recordAuditEvent,
  recordAuditEventsBatch,
  type RecordAuditEventInput,
} from "@/lib/services/audit.service";
import { calculateLevel } from "@/lib/domain/hierarchy";
import { normalizeWorkEmail } from "@/lib/domain/normalize";

/** Uploaded files are retained only long enough to be validated and executed, per docs/DECISIONS.md's Phase 10 retention decision. */
export const IMPORT_RETENTION_DAYS = 7;
export const MAX_IMPORT_FILE_SIZE_BYTES = MAX_FILE_SIZE_BYTES;

const REQUIRED_COLUMNS_BY_TYPE: Record<ImportType, readonly string[]> = {
  DEPARTMENT: DEPARTMENT_REQUIRED_COLUMNS,
  POSITION: POSITION_REQUIRED_COLUMNS,
  EMPLOYEE: EMPLOYEE_REQUIRED_COLUMNS,
  ASSIGNMENT: ASSIGNMENT_REQUIRED_COLUMNS,
};

const TERMINAL_STATUSES = new Set([
  "COMPLETED",
  "FAILED",
  "VALIDATION_FAILED",
  "CANCELLED",
  "EXPIRED",
]);

function sanitizeFilename(name: string): string {
  const withoutPath = name.split(/[/\\]/).pop() ?? name;
  const sanitized = withoutPath
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .slice(0, 200)
    .trim();
  return sanitized.length > 0 ? sanitized : "upload.csv";
}

function isExpired(job: ImportJob): boolean {
  return job.expiresAt.getTime() < Date.now();
}

/**
 * A job past its retention window is treated as EXPIRED on the next read
 * that touches it — there is no background job scheduler in this app, so
 * expiry is enforced lazily rather than by a cron sweep (a documented,
 * reversible simplification — see docs/DECISIONS.md).
 */
async function loadJobAndExpireIfStale(
  jobId: string,
  companyId: string,
  db: DbClient
): Promise<ImportJob> {
  const job = await findImportJobById(jobId, companyId, db);
  if (!job) throw new NotFoundError("ImportJob", jobId);
  if (!TERMINAL_STATUSES.has(job.status) && isExpired(job)) {
    return updateImportJob(job.id, { status: "EXPIRED", rawFile: null }, db);
  }
  return job;
}

export interface UploadImportInput {
  companyId: string;
  userId: string;
  importType: ImportType;
  importMode: ImportMode;
  originalFilename: string;
  fileBuffer: Buffer;
}

/**
 * Stage 1 (file-level) checks that don't need the file's *content*
 * parsed yet — size and non-emptiness. Everything content-shaped (row
 * count, headers, encoding) happens in `validateImportJob`, since it
 * requires actually parsing the file.
 */
export async function uploadImportFile(input: UploadImportInput): Promise<ImportJob> {
  if (input.fileBuffer.length === 0) {
    throw new DomainValidationError("The uploaded file is empty.");
  }
  if (input.fileBuffer.length > MAX_IMPORT_FILE_SIZE_BYTES) {
    throw new DomainValidationError(
      `The uploaded file exceeds the maximum size of ${Math.floor(MAX_IMPORT_FILE_SIZE_BYTES / (1024 * 1024))}MB.`
    );
  }

  const fileChecksum = crypto.createHash("sha256").update(input.fileBuffer).digest("hex");
  const expiresAt = new Date(Date.now() + IMPORT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  return createImportJob({
    companyId: input.companyId,
    requestedByUserId: input.userId,
    importType: input.importType,
    importMode: input.importMode,
    originalFilename: sanitizeFilename(input.originalFilename),
    fileChecksum,
    fileSize: input.fileBuffer.length,
    rawFile: input.fileBuffer,
    expiresAt,
  });
}

async function fetchDepartmentSnapshots(
  companyId: string,
  db: DbClient
): Promise<ExistingDepartmentSnapshot[]> {
  const departments = await listDepartmentsForCompany(companyId, db);
  const byId = new Map(departments.map((d) => [d.id, d]));
  return departments.map((d) => ({
    id: d.id,
    code: normalizeCode(d.code),
    name: d.name,
    description: d.description,
    color: d.color,
    parentCode: d.parentDepartmentId
      ? normalizeCode(byId.get(d.parentDepartmentId)?.code ?? "")
      : null,
    status: d.status,
  }));
}

async function fetchPositionSnapshots(
  companyId: string,
  db: DbClient
): Promise<{
  positions: ExistingPositionSnapshotForImport[];
  departmentCodes: { code: string }[];
  jobGradeCodes: { code: string }[];
}> {
  const [positions, departments, jobGrades] = await Promise.all([
    listAllPositionsForCompany(companyId, db),
    listDepartmentsForCompany(companyId, db),
    listJobGradesForCompany(companyId, db),
  ]);
  const departmentById = new Map(departments.map((d) => [d.id, normalizeCode(d.code)]));
  const jobGradeById = new Map(jobGrades.map((g) => [g.id, normalizeCode(g.code)]));
  const positionById = new Map(positions.map((p) => [p.id, p]));

  return {
    positions: positions.map((p) => ({
      id: p.id,
      code: normalizeCode(p.positionCode),
      title: p.title,
      description: p.description,
      location: p.location,
      departmentCode: departmentById.get(p.departmentId) ?? "",
      jobGradeCode: p.jobGradeId ? (jobGradeById.get(p.jobGradeId) ?? null) : null,
      reportsToCode: p.primaryReportsToPositionId
        ? normalizeCode(positionById.get(p.primaryReportsToPositionId)?.positionCode ?? "")
        : null,
      status: p.status === "PLANNED" ? "ACTIVE" : p.status,
    })),
    departmentCodes: departments.map((d) => ({ code: normalizeCode(d.code) })),
    jobGradeCodes: jobGrades.map((g) => ({ code: normalizeCode(g.code) })),
  };
}

async function fetchEmployeeSnapshots(
  companyId: string,
  db: DbClient
): Promise<ExistingEmployeeSnapshot[]> {
  const employees = await listAllEmployeesForCompany(companyId, db);
  return employees.map((e) => ({
    id: e.id,
    code: normalizeCode(e.employeeCode),
    firstName: e.firstName,
    lastName: e.lastName,
    preferredName: e.preferredName,
    workEmail: e.workEmail,
    employmentStatus: e.employmentStatus,
    joiningDate: e.joiningDate ? e.joiningDate.toISOString().slice(0, 10) : null,
    leavingDate: e.leavingDate ? e.leavingDate.toISOString().slice(0, 10) : null,
  }));
}

async function fetchAssignmentContext(companyId: string, db: DbClient) {
  const [employees, positions, openAssignments] = await Promise.all([
    listAllEmployeesForCompany(companyId, db),
    listAllPositionsForCompany(companyId, db),
    listAllOpenAssignmentsForCompany(companyId, db),
  ]);
  const employeeById = new Map(employees.map((e) => [e.id, normalizeCode(e.employeeCode)]));
  const positionById = new Map(positions.map((p) => [p.id, normalizeCode(p.positionCode)]));

  return {
    employees: employees.map((e) => ({
      code: normalizeCode(e.employeeCode),
      employmentStatus: e.employmentStatus,
    })),
    positions: positions.map((p) => ({ code: normalizeCode(p.positionCode), status: p.status })),
    assignments: openAssignments.map((a) => ({
      employeeCode: employeeById.get(a.employeeId) ?? "",
      positionCode: positionById.get(a.positionId) ?? "",
      startDate: a.startDate.toISOString().slice(0, 10),
      endDate: a.endDate ? a.endDate.toISOString().slice(0, 10) : null,
    })),
  };
}

async function runValidation(
  importType: ImportType,
  importMode: ImportMode,
  parsed: ReturnType<typeof parseCsvFile>,
  companyId: string,
  db: DbClient
): Promise<ValidationOutcome<unknown>> {
  switch (importType) {
    case "DEPARTMENT": {
      const existing = await fetchDepartmentSnapshots(companyId, db);
      return validateDepartmentRows(parsed, importMode, existing);
    }
    case "POSITION": {
      const { positions, departmentCodes, jobGradeCodes } = await fetchPositionSnapshots(
        companyId,
        db
      );
      return validatePositionRows(parsed, importMode, positions, departmentCodes, jobGradeCodes);
    }
    case "EMPLOYEE": {
      const existing = await fetchEmployeeSnapshots(companyId, db);
      return validateEmployeeRows(parsed, importMode, existing);
    }
    case "ASSIGNMENT": {
      const { employees, positions, assignments } = await fetchAssignmentContext(companyId, db);
      return validateAssignmentRows(parsed, employees, positions, assignments);
    }
  }
}

/**
 * Stage 1-6 (ADR-0007's `parse`): decodes and validates the uploaded file
 * against the current database state, writes NOTHING to the entity
 * tables, and persists only the resulting preview (`rowPlan` + issues +
 * summary counts) on the job itself.
 */
export async function validateImportJob(jobId: string, companyId: string): Promise<ImportJob> {
  const job = await loadJobAndExpireIfStale(jobId, companyId, prisma);
  if (job.status === "EXPIRED") return job;
  if (!job.rawFile) {
    throw new UnsafeMutationError(
      `Import job ${jobId} has no file to validate (already finalized).`
    );
  }

  await deleteImportRowIssues(jobId);

  let parsed: ReturnType<typeof parseCsvFile>;
  try {
    const text = decodeCsvBuffer(Buffer.from(job.rawFile));
    parsed = parseCsvFile(text, REQUIRED_COLUMNS_BY_TYPE[job.importType]);
  } catch (error) {
    if (error instanceof CsvFileError) {
      await createImportRowIssues(jobId, [
        {
          rowNumber: 0,
          field: null,
          severity: "ERROR",
          code: error.code,
          safeMessage: error.message,
        },
      ]);
      const failed = await updateImportJob(jobId, {
        status: "VALIDATION_FAILED",
        errorMessage: error.message,
        validatedAt: new Date(),
        rawFile: null,
        totalRows: 0,
        errorRows: 1,
      });
      await recordAuditEvent({
        companyId,
        actor: { userId: job.requestedByUserId, displayName: null, email: null },
        action: "IMPORT_FAILED",
        category: "IMPORT",
        entityType: "ImportJob",
        entityId: failed.id,
        correlationId: failed.id,
        importJobId: failed.id,
        metadata: { reason: "file-level parse error", code: error.code },
      });
      return failed;
    }
    throw error;
  }

  const outcome = await runValidation(job.importType, job.importMode, parsed, companyId, prisma);
  return persistValidationOutcome(job, outcome);
}

async function persistValidationOutcome(
  job: ImportJob,
  outcome: ValidationOutcome<unknown>
): Promise<ImportJob> {
  await createImportRowIssues(
    job.id,
    outcome.issues.map((issue) => ({
      rowNumber: issue.rowNumber,
      field: issue.field,
      severity: issue.severity,
      code: issue.code,
      safeMessage: issue.safeMessage,
    }))
  );

  const hasErrors = outcome.errorRowCount > 0;
  const result = await updateImportJob(job.id, {
    status: hasErrors ? "VALIDATION_FAILED" : "VALIDATED",
    rowPlan: outcome.rows as unknown as Prisma.InputJsonValue,
    totalRows: outcome.totalRows,
    validRows: outcome.totalRows - outcome.errorRowCount,
    warningRows: outcome.warningRowCount,
    errorRows: outcome.errorRowCount,
    createCount: outcome.createCount,
    updateCount: outcome.updateCount,
    unchangedCount: outcome.unchangedCount,
    validatedAt: new Date(),
    warningsAcknowledged: false,
    rawFile: hasErrors ? null : job.rawFile,
  });

  await recordAuditEvent({
    companyId: job.companyId,
    actor: { userId: job.requestedByUserId, displayName: null, email: null },
    action: hasErrors ? "IMPORT_FAILED" : "IMPORT_VALIDATED",
    category: "IMPORT",
    entityType: "ImportJob",
    entityId: result.id,
    correlationId: result.id,
    importJobId: result.id,
    metadata: {
      totalRows: outcome.totalRows,
      errorRowCount: outcome.errorRowCount,
      warningRowCount: outcome.warningRowCount,
    },
  });
  return result;
}

/**
 * Transitions a VALIDATED job (zero blocking errors) to READY_TO_EXECUTE.
 * Requires explicit warning acknowledgement when the last validation
 * reported any warnings (Step 9.8 / Critical Safety Principle 4) — the
 * caller (the server action) is responsible for having actually shown the
 * warnings to the user before setting `acknowledgeWarnings: true`.
 */
export async function confirmImportJob(
  jobId: string,
  companyId: string,
  acknowledgeWarnings: boolean
): Promise<ImportJob> {
  const job = await loadJobAndExpireIfStale(jobId, companyId, prisma);
  if (job.status === "EXPIRED") return job;
  if (job.status !== "VALIDATED") {
    throw new UnsafeMutationError(
      `Import job ${jobId} cannot be confirmed from status ${job.status} — it must be VALIDATED with zero blocking errors.`
    );
  }
  if (job.warningRows > 0 && !acknowledgeWarnings) {
    throw new UnsafeMutationError(
      `Import job ${jobId} has ${job.warningRows} row(s) with warnings that must be explicitly acknowledged before executing.`
    );
  }
  return updateImportJob(jobId, { status: "READY_TO_EXECUTE", warningsAcknowledged: true });
}

export async function cancelImportJob(jobId: string, companyId: string): Promise<ImportJob> {
  const job = await loadJobAndExpireIfStale(jobId, companyId, prisma);
  if (TERMINAL_STATUSES.has(job.status)) return job;
  return updateImportJob(jobId, { status: "CANCELLED", rawFile: null });
}

export interface ExecuteImportResult {
  job: ImportJob;
  stale: boolean;
}

/**
 * Stage 10-11 (ADR-0007's `commit`): re-parses and re-validates the
 * original file FRESH, inside the same transaction as every write —
 * never trusting the stored `rowPlan` as final authorization (Step 10.7).
 * If the fresh outcome differs from what was last validated (something
 * else changed the data in between), the whole batch is aborted and the
 * job is sent back to VALIDATION_FAILED with fresh issues, never
 * partially applied. Idempotent: calling this again on an already-
 * COMPLETED job is a no-op that returns the existing result.
 */
export async function executeImportJob(
  jobId: string,
  companyId: string
): Promise<ExecuteImportResult> {
  const initial = await loadJobAndExpireIfStale(jobId, companyId, prisma);
  if (initial.status === "EXPIRED") return { job: initial, stale: false };
  if (initial.status === "COMPLETED") return { job: initial, stale: false };
  if (initial.status !== "READY_TO_EXECUTE") {
    throw new UnsafeMutationError(
      `Import job ${jobId} cannot be executed from status ${initial.status} — it must be READY_TO_EXECUTE.`
    );
  }
  if (!initial.rawFile) {
    throw new UnsafeMutationError(`Import job ${jobId} has no file to execute.`);
  }

  const rawFile = Buffer.from(initial.rawFile);
  const checksum = crypto.createHash("sha256").update(rawFile).digest("hex");
  if (checksum !== initial.fileChecksum) {
    throw new UnsafeMutationError(
      `Import job ${jobId}'s stored file checksum no longer matches — refusing to execute.`
    );
  }

  try {
    const result = await withTransaction(
      prisma,
      async (tx) => {
        // Lock the job row for the duration of execution so a concurrent
        // second execute request for the SAME job serializes behind this
        // one rather than racing it (idempotency — Step 15.2/15.3).
        await tx.$queryRaw`SELECT id FROM "import_jobs" WHERE id = ${jobId}::uuid FOR UPDATE`;
        const current = await tx.importJob.findFirst({ where: { id: jobId, companyId } });
        if (!current) throw new NotFoundError("ImportJob", jobId);
        if (current.status === "COMPLETED") return { alreadyDone: true as const, job: current };
        if (current.status !== "READY_TO_EXECUTE") {
          throw new UnsafeMutationError(
            `Import job ${jobId} is no longer READY_TO_EXECUTE (status: ${current.status}).`
          );
        }

        const text = decodeCsvBuffer(rawFile);
        const parsed = parseCsvFile(text, REQUIRED_COLUMNS_BY_TYPE[current.importType]);
        const freshOutcome = await runValidation(
          current.importType,
          current.importMode,
          parsed,
          companyId,
          tx
        );

        if (freshOutcome.errorRowCount > 0) {
          return { alreadyDone: false as const, stale: true as const, freshOutcome };
        }

        const orderedRows = buildDeterministicApplyOrder(current.importType, freshOutcome.rows);
        await applyOrderedRows(current.importType, companyId, orderedRows, tx);

        const completed = await tx.importJob.update({
          where: { id: jobId },
          data: {
            status: "COMPLETED",
            executedAt: new Date(),
            rawFile: null,
            createCount: freshOutcome.createCount,
            updateCount: freshOutcome.updateCount,
            unchangedCount: freshOutcome.unchangedCount,
          },
        });

        // Job-level summary event, same transaction as every row this
        // execution applied (Step 7.E) — required, not best-effort: if
        // this write fails, the whole execution rolls back with it,
        // exactly like every row change above (ADR-0008).
        await recordAuditEvent(
          {
            companyId,
            actor: { userId: current.requestedByUserId, displayName: null, email: null },
            action: "IMPORT_EXECUTED",
            category: "IMPORT",
            entityType: "ImportJob",
            entityId: completed.id,
            correlationId: completed.id,
            importJobId: completed.id,
            metadata: {
              importType: completed.importType,
              createCount: freshOutcome.createCount,
              updateCount: freshOutcome.updateCount,
              unchangedCount: freshOutcome.unchangedCount,
              rowCount: freshOutcome.totalRows,
            },
          },
          tx
        );
        return { alreadyDone: false as const, stale: false as const, job: completed };
      },
      // Phase 13 hardening (DEF-009): this transaction applies EVERY row
      // of the import sequentially (each its own several DB round trips)
      // inside one atomic commit — Prisma's default 5,000ms interactive-
      // transaction timeout was measured to reliably fail an import of
      // 1,000+ rows outright (not just run slowly), well inside this
      // app's own ~2,000-row design target (docs/DECISIONS.md P7,
      // docs/PROJECT_SPEC.md §14). 120s comfortably covers that target
      // with a large margin (measured ~5.5-6s just to exceed the OLD
      // 5s limit at 1,000-5,000 rows, per docs/PERFORMANCE_REPORT.md);
      // maxWait (time allowed to even acquire the transaction/connection
      // before starting) is raised in step with it so a momentarily busy
      // connection pool doesn't itself become a new failure mode.
      { timeout: 120_000, maxWait: 10_000 }
    );

    if (result.alreadyDone) return { job: result.job, stale: false };
    if (result.stale) {
      await deleteImportRowIssues(jobId);
      await createImportRowIssues(
        jobId,
        result.freshOutcome.issues.map((issue: RowIssue) => ({
          rowNumber: issue.rowNumber,
          field: issue.field,
          severity: issue.severity,
          code: issue.code,
          safeMessage: issue.safeMessage,
        }))
      );
      const staleJob = await updateImportJob(jobId, {
        status: "VALIDATION_FAILED",
        errorMessage:
          "The data changed since this file was last validated — please re-validate before executing.",
        errorRows: result.freshOutcome.errorRowCount,
        warningRows: result.freshOutcome.warningRowCount,
      });
      // Best-effort — the primary transaction already concluded (nothing
      // was applied), so this is a separate write documenting the
      // rejection, not a critical event that must roll back anything.
      await recordAuditEvent({
        companyId,
        actor: { userId: initial.requestedByUserId, displayName: null, email: null },
        action: "IMPORT_FAILED",
        category: "IMPORT",
        entityType: "ImportJob",
        entityId: staleJob.id,
        correlationId: staleJob.id,
        importJobId: staleJob.id,
        metadata: { reason: "stale validation" },
      });
      return { job: staleJob, stale: true };
    }
    return { job: result.job, stale: false };
  } catch (error) {
    const failed = await updateImportJob(jobId, {
      status: "FAILED",
      errorMessage:
        error instanceof Error
          ? "Execution failed and was fully rolled back."
          : "Execution failed and was fully rolled back.",
      executedAt: new Date(),
    });
    await recordAuditEvent({
      companyId,
      actor: { userId: initial.requestedByUserId, displayName: null, email: null },
      action: "IMPORT_FAILED",
      category: "IMPORT",
      entityType: "ImportJob",
      entityId: failed.id,
      correlationId: failed.id,
      importJobId: failed.id,
      metadata: { reason: "execution error, fully rolled back" },
    });
    throw error;
  }
}

/**
 * Postgres allows at most 65,535 bound parameters per statement. A bulk
 * `createMany`/`createManyAndReturn` on Position (~13 columns) or the
 * batched-audit insert (~14 columns) stays comfortably under that at this
 * chunk size even at the 5,000-row scale this app is designed for
 * (docs/DECISIONS.md P7) — chunking exists purely as that defensive
 * ceiling, not because any currently-supported import size needs more
 * than one chunk in practice.
 */
const BULK_INSERT_CHUNK_SIZE = 1000;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Groups rows into dependency "layers": layer 0 holds every row whose
 * dependency is null, already exists in the database, or isn't itself a
 * row in this batch; layer N holds rows whose dependency is satisfied by
 * layer N-1. Same acyclic guarantee as `topologicalSort` below (validation
 * already proved the combined graph is acyclic via `findCycleInGraph`) —
 * this is the identical algorithm, just yielding each wave separately
 * instead of concatenating them, so the bulk-create path (Phase 13.1,
 * DEF-009) can insert one wave at a time with `createManyAndReturn`
 * instead of one `INSERT` per row.
 */
function layerRowsByDependency<T>(
  rows: readonly RowPlanEntry<T>[],
  dependencyCodeOf: (row: RowPlanEntry<T>) => string | null
): RowPlanEntry<T>[][] {
  const byCode = new Set(rows.map((r) => r.matchingCode));
  const applied = new Set<string>();
  const layers: RowPlanEntry<T>[][] = [];
  let remaining = [...rows];

  while (remaining.length > 0) {
    const ready = remaining.filter((row) => {
      const dep = dependencyCodeOf(row);
      return dep === null || applied.has(dep) || !byCode.has(dep);
    });
    if (ready.length === 0) {
      // Defensive backstop only — validation already proved this graph is
      // acyclic, so this branch should be unreachable in practice.
      layers.push(remaining);
      break;
    }
    layers.push(ready);
    for (const row of ready) applied.add(row.matchingCode);
    remaining = remaining.filter((row) => !ready.includes(row));
  }

  return layers;
}

/**
 * Bulk-creates every CREATE-action POSITION row using `createManyAndReturn`
 * (one statement per dependency layer/chunk instead of one per row) plus a
 * single batched audit insert, instead of looping `createPosition` once per
 * row (Phase 13.1 remediation of DEF-009 — see
 * docs/phase-reports/PHASE_13_1_PERFORMANCE_REMEDIATION.md for the root-
 * cause analysis and before/after measurements).
 *
 * Safety is preserved by construction, not by re-implementing hierarchy
 * logic (organogram-hierarchy-safety skill's "never let CSV import
 * implement its own copy of hierarchy validation logic"):
 * - `organizationalLevel` is computed with the exact same
 *   `calculateLevel` function `hierarchy.service.ts` itself uses, never a
 *   parallel formula.
 * - Cycle-freedom and reference validity for the WHOLE batch were already
 *   proven moments ago, inside this same transaction, by `runValidation`'s
 *   fresh re-validation (`freshOutcome`) — there is no window for a
 *   concurrent write to invalidate that between the check and this write,
 *   since both happen under one transaction.
 * - `departmentId`/`jobGradeId`/`primaryReportsToPositionId` are resolved
 *   only from this company's own already-fetched snapshot data (or a
 *   position created earlier in this very function, itself derived the
 *   same way) — never from another company's data, so cross-company
 *   references remain structurally impossible.
 * - A genuine DB-level constraint violation (duplicate code, a second
 *   root) still throws and is translated via the exact same
 *   `translateWriteError` `hierarchy.service.ts` uses for a single
 *   `create` — the bulk path can't identify which specific row in a
 *   multi-row `INSERT` triggered it, so the resulting error names the
 *   dependency layer rather than one row number, a documented, acceptable
 *   precision trade-off for the bulk path only.
 * - UPDATE rows (including position moves) are NOT bulk-optimized in this
 *   pass — they continue through the existing, fully safety-checked
 *   per-row `applyRow`/`movePosition` path. This benchmark's synthetic
 *   workload (docs/PERFORMANCE_REPORT.md rows 7-8) is 100% CREATE, matching
 *   the dominant real-world "onboard a new company's org chart" bulk-import
 *   shape; bulk-optimizing hierarchy MOVES (which require recalculating
 *   whole descendant subtrees, not just a flat insert) is a materially
 *   larger, higher-risk change deliberately left out of this remediation's
 *   scope — see the Known Limitations section of
 *   docs/phase-reports/PHASE_13_1_PERFORMANCE_REMEDIATION.md.
 */
async function applyPositionCreatesBulk(
  companyId: string,
  createRows: readonly RowPlanEntry<NormalizedPositionRow>[],
  context: {
    departmentCodeToId: Map<string, string>;
    jobGradeCodeToId: Map<string, string>;
    positionCodeToId: Map<string, string>;
    positionCodeToLevel: Map<string, number>;
  },
  tx: DbClient
): Promise<void> {
  if (createRows.length === 0) return;

  const layers = layerRowsByDependency(createRows, (row) => {
    const n = row.normalized;
    return n?.reportsToCode.kind === "value" ? n.reportsToCode.value : null;
  });

  const auditInputs: RecordAuditEventInput[] = [];

  for (const layer of layers) {
    for (const rowChunk of chunk(layer, BULK_INSERT_CHUNK_SIZE)) {
      const data = rowChunk.map((row) => {
        const n = row.normalized;
        if (!n) throw new Error("Internal error: CREATE row missing normalized data.");

        const departmentId = context.departmentCodeToId.get(n.departmentCode);
        if (!departmentId) throw new NotFoundError("Department", n.departmentCode);

        const jobGradeId =
          n.jobGradeCode.kind === "value"
            ? (context.jobGradeCodeToId.get(n.jobGradeCode.value) ?? null)
            : null;

        const reportsToCode = n.reportsToCode.kind === "value" ? n.reportsToCode.value : null;
        const reportsToId = reportsToCode
          ? (context.positionCodeToId.get(reportsToCode) ?? null)
          : null;
        const parentLevel = reportsToCode
          ? (context.positionCodeToLevel.get(reportsToCode) ?? null)
          : null;

        return {
          id: crypto.randomUUID(),
          companyId,
          departmentId,
          jobGradeId,
          title: n.title.trim(),
          positionCode: n.code,
          description: resolveFieldForWrite(n.description, null),
          location: resolveFieldForWrite(n.location, null),
          primaryReportsToPositionId: reportsToId,
          organizationalLevel: calculateLevel(parentLevel),
        };
      });

      let created;
      try {
        created = await tx.position.createManyAndReturn({ data });
      } catch (error) {
        throw translatePositionWriteError(
          error,
          rowChunk.map((r) => r.matchingCode).join(", "),
          false
        );
      }

      for (const position of created) {
        context.positionCodeToId.set(position.positionCode, position.id);
        context.positionCodeToLevel.set(position.positionCode, position.organizationalLevel);
        auditInputs.push({
          companyId,
          actor: "SYSTEM",
          action: "CREATED",
          category: "POSITION",
          entityType: "Position",
          entityId: position.id,
          entityDisplayReference: position.positionCode,
          after: position,
        });
      }
    }
  }

  for (const auditChunk of chunk(auditInputs, BULK_INSERT_CHUNK_SIZE)) {
    await recordAuditEventsBatch(auditChunk, tx);
  }
}

/** Same technique as `applyPositionCreatesBulk`, without a level to compute — see that function's doc comment for the full safety rationale. */
async function applyDepartmentCreatesBulk(
  companyId: string,
  createRows: readonly RowPlanEntry<NormalizedDepartmentRow>[],
  context: { departmentCodeToId: Map<string, string> },
  tx: DbClient
): Promise<void> {
  if (createRows.length === 0) return;

  const layers = layerRowsByDependency(createRows, (row) => {
    const n = row.normalized;
    return n?.parentCode.kind === "value" ? n.parentCode.value : null;
  });

  const auditInputs: RecordAuditEventInput[] = [];

  for (const layer of layers) {
    for (const rowChunk of chunk(layer, BULK_INSERT_CHUNK_SIZE)) {
      const data = rowChunk.map((row) => {
        const n = row.normalized;
        if (!n) throw new Error("Internal error: CREATE row missing normalized data.");
        const parentId =
          n.parentCode.kind === "value"
            ? (context.departmentCodeToId.get(n.parentCode.value) ?? null)
            : null;
        return {
          id: crypto.randomUUID(),
          companyId,
          name: n.name.trim(),
          code: n.code,
          description: resolveFieldForWrite(n.description, null),
          color: resolveFieldForWrite(n.color, null),
          parentDepartmentId: parentId,
        };
      });

      let created;
      try {
        created = await tx.department.createManyAndReturn({ data });
      } catch (error) {
        throw translateDepartmentWriteError(
          error,
          "Department",
          rowChunk.map((r) => r.matchingCode).join(", ")
        );
      }

      for (const department of created) {
        context.departmentCodeToId.set(department.code, department.id);
        auditInputs.push({
          companyId,
          actor: "SYSTEM",
          action: "CREATED",
          category: "DEPARTMENT",
          entityType: "Department",
          entityId: department.id,
          entityDisplayReference: department.code,
          after: department,
        });
      }
    }
  }

  for (const auditChunk of chunk(auditInputs, BULK_INSERT_CHUNK_SIZE)) {
    await recordAuditEventsBatch(auditChunk, tx);
  }
}

/** Same technique, further simplified — Employee rows have no inter-row dependency, so there is exactly one "layer." See `applyPositionCreatesBulk`'s doc comment for the full safety rationale. */
async function applyEmployeeCreatesBulk(
  companyId: string,
  createRows: readonly RowPlanEntry<NormalizedEmployeeRow>[],
  tx: DbClient
): Promise<void> {
  if (createRows.length === 0) return;

  const auditInputs: RecordAuditEventInput[] = [];

  for (const rowChunk of chunk(createRows, BULK_INSERT_CHUNK_SIZE)) {
    const data = rowChunk.map((row) => {
      const n = row.normalized;
      if (!n) throw new Error("Internal error: CREATE row missing normalized data.");
      const joiningDate = resolveFieldForWrite(n.joiningDate, null);
      return {
        id: crypto.randomUUID(),
        companyId,
        employeeCode: n.code,
        firstName: n.firstName.trim(),
        lastName: n.lastName.trim(),
        preferredName: resolveFieldForWrite(n.preferredName, null),
        workEmail: normalizeWorkEmail(resolveFieldForWrite(n.workEmail, null)),
        joiningDate: joiningDate ? new Date(`${joiningDate}T00:00:00.000Z`) : null,
      };
    });

    let created;
    try {
      created = await tx.employee.createManyAndReturn({ data });
    } catch (error) {
      throw translateEmployeeWriteError(
        error,
        rowChunk.map((r) => r.matchingCode).join(", "),
        null
      );
    }

    for (const employee of created) {
      auditInputs.push({
        companyId,
        actor: "SYSTEM",
        action: "CREATED",
        category: "EMPLOYEE",
        entityType: "Employee",
        entityId: employee.id,
        entityDisplayReference: employee.employeeCode,
        after: employee,
      });
    }
  }

  for (const auditChunk of chunk(auditInputs, BULK_INSERT_CHUNK_SIZE)) {
    await recordAuditEventsBatch(auditChunk, tx);
  }
}

/**
 * Rows must be APPLIED in an order that respects same-file dependencies
 * (Step 11.10) — validation already proves a "manager appears later in
 * the file" row is resolvable, but applying rows in raw file order would
 * still try to look up a not-yet-created department/position and
 * silently treat the unresolved reference as "no parent," which is
 * exactly how a shuffled-parent-rows file could accidentally create a
 * false root. Departments/positions are topologically sorted by their
 * same-batch parent/manager dependency; assignment operations are sorted
 * by effective date (mirroring the validator's own per-employee/
 * per-position timeline simulation) so an ASSIGN is always applied
 * before a later TRANSFER for the same employee. Employees have no
 * inter-row dependency at all.
 */
function buildDeterministicApplyOrder<T>(
  importType: ImportType,
  rows: readonly RowPlanEntry<T>[]
): RowPlanEntry<T>[] {
  if (importType === "DEPARTMENT") {
    return topologicalSort(rows, (row) => {
      const n = row.normalized as NormalizedDepartmentRow | null;
      return n?.parentCode.kind === "value" ? n.parentCode.value : null;
    });
  }
  if (importType === "POSITION") {
    return topologicalSort(rows, (row) => {
      const n = row.normalized as NormalizedPositionRow | null;
      return n?.reportsToCode.kind === "value" ? n.reportsToCode.value : null;
    });
  }
  if (importType === "ASSIGNMENT") {
    return [...rows].sort((a, b) => {
      const an = a.normalized as NormalizedAssignmentRow | null;
      const bn = b.normalized as NormalizedAssignmentRow | null;
      const dateA = an?.effectiveDate ?? an?.endDate ?? "";
      const dateB = bn?.effectiveDate ?? bn?.endDate ?? "";
      if (dateA !== dateB) return dateA < dateB ? -1 : 1;
      return a.rowNumber - b.rowNumber;
    });
  }
  return [...rows];
}

/**
 * Repeatedly applies whatever rows have no unresolved same-batch
 * dependency left, until every row is placed. A row whose dependency
 * resolves to an existing DB record (not itself a row in this batch) or
 * to nothing at all is immediately ready. Terminates because validation
 * already proved the combined graph is acyclic (`findCycleInGraph`) — the
 * fallback appends any leftover rows in their original order rather than
 * looping forever, purely as a defensive backstop.
 */
function topologicalSort<T>(
  rows: readonly RowPlanEntry<T>[],
  dependencyCodeOf: (row: RowPlanEntry<T>) => string | null
): RowPlanEntry<T>[] {
  const byCode = new Set(rows.map((r) => r.matchingCode));
  const applied = new Set<string>();
  const sorted: RowPlanEntry<T>[] = [];
  let remaining = [...rows];

  while (remaining.length > 0) {
    const ready = remaining.filter((row) => {
      const dep = dependencyCodeOf(row);
      return dep === null || applied.has(dep) || !byCode.has(dep);
    });
    if (ready.length === 0) {
      sorted.push(...remaining);
      break;
    }
    sorted.push(...ready);
    for (const row of ready) applied.add(row.matchingCode);
    remaining = remaining.filter((row) => !ready.includes(row));
  }

  return sorted;
}

/**
 * Applies one execution's full ordered row set. CREATE rows for
 * DEPARTMENT/POSITION/EMPLOYEE go through the bulk path (Phase 13.1,
 * DEF-009 remediation — see `applyPositionCreatesBulk`'s doc comment for
 * the full safety rationale); every other row (UPDATE, and all of
 * ASSIGNMENT) continues through the original, fully safety-checked
 * per-row `applyRow` path, in `orderedRows`' existing relative order.
 * Applying every CREATE first is safe: a later UPDATE that references a
 * just-created row resolves it by CODE via a fresh DB lookup (codes never
 * change when a position/department moves), and no CREATE row's fields
 * depend on any UPDATE row's outcome — `buildDeterministicApplyOrder`'s
 * interleaving matters only within a category (creates depending on
 * other creates in the same batch, updates' cross-row date ordering for
 * ASSIGNMENT), never across it.
 */
async function applyOrderedRows(
  importType: ImportType,
  companyId: string,
  orderedRows: readonly RowPlanEntry<unknown>[],
  tx: DbClient
): Promise<void> {
  if (importType === "ASSIGNMENT") {
    for (const row of orderedRows) {
      if (row.action === "UNCHANGED" || row.action === "ERROR") continue;
      await applyRow(importType, companyId, row, tx);
    }
    return;
  }

  const createRows = orderedRows.filter((r) => r.action === "CREATE");
  const remainingRows = orderedRows.filter(
    (r) => r.action !== "CREATE" && r.action !== "UNCHANGED" && r.action !== "ERROR"
  );

  if (importType === "POSITION" && createRows.length > 0) {
    const [departments, jobGrades, positions] = await Promise.all([
      listDepartmentsForCompany(companyId, tx),
      listJobGradesForCompany(companyId, tx),
      listAllPositionsForCompany(companyId, tx),
    ]);
    await applyPositionCreatesBulk(
      companyId,
      createRows as RowPlanEntry<NormalizedPositionRow>[],
      {
        departmentCodeToId: new Map(departments.map((d) => [normalizeCode(d.code), d.id])),
        jobGradeCodeToId: new Map(jobGrades.map((g) => [normalizeCode(g.code), g.id])),
        positionCodeToId: new Map(positions.map((p) => [normalizeCode(p.positionCode), p.id])),
        positionCodeToLevel: new Map(
          positions.map((p) => [normalizeCode(p.positionCode), p.organizationalLevel])
        ),
      },
      tx
    );
  } else if (importType === "DEPARTMENT" && createRows.length > 0) {
    const departments = await listDepartmentsForCompany(companyId, tx);
    await applyDepartmentCreatesBulk(
      companyId,
      createRows as RowPlanEntry<NormalizedDepartmentRow>[],
      { departmentCodeToId: new Map(departments.map((d) => [normalizeCode(d.code), d.id])) },
      tx
    );
  } else if (importType === "EMPLOYEE" && createRows.length > 0) {
    await applyEmployeeCreatesBulk(
      companyId,
      createRows as RowPlanEntry<NormalizedEmployeeRow>[],
      tx
    );
  }

  for (const row of remainingRows) {
    await applyRow(importType, companyId, row, tx);
  }
}

async function applyRow(
  importType: ImportType,
  companyId: string,
  row: RowPlanEntry<unknown>,
  tx: DbClient
): Promise<void> {
  switch (importType) {
    case "DEPARTMENT":
      return applyDepartmentRow(companyId, row as RowPlanEntry<NormalizedDepartmentRow>, tx);
    case "POSITION":
      return applyPositionRow(companyId, row as RowPlanEntry<NormalizedPositionRow>, tx);
    case "EMPLOYEE":
      return applyEmployeeRow(companyId, row as RowPlanEntry<NormalizedEmployeeRow>, tx);
    case "ASSIGNMENT":
      return applyAssignmentRow(companyId, row as RowPlanEntry<NormalizedAssignmentRow>, tx);
  }
}

async function findDepartmentIdByCode(
  companyId: string,
  code: string,
  tx: DbClient
): Promise<string | null> {
  const dept = await tx.department.findFirst({ where: { companyId, code } });
  return dept?.id ?? null;
}

async function applyDepartmentRow(
  companyId: string,
  row: RowPlanEntry<NormalizedDepartmentRow>,
  tx: DbClient
): Promise<void> {
  const n = row.normalized;
  if (!n) return;

  if (row.action === "CREATE") {
    const parentId =
      n.parentCode.kind === "value"
        ? await findDepartmentIdByCode(companyId, n.parentCode.value, tx)
        : null;
    await createDepartment(
      {
        companyId,
        name: n.name,
        code: n.code,
        description: resolveFieldForWrite(n.description, null),
        color: resolveFieldForWrite(n.color, null),
        parentDepartmentId: parentId,
      },
      tx
    );
    return;
  }

  // UPDATE
  const existing = await tx.department.findFirst({ where: { companyId, code: n.code } });
  if (!existing) throw new NotFoundError("Department", n.code);

  await updateDepartment(
    {
      companyId,
      departmentId: existing.id,
      name: n.name,
      description: resolveFieldForWrite(n.description, existing.description),
      color: resolveFieldForWrite(n.color, existing.color),
    },
    tx
  );

  const currentParentCode = existing.parentDepartmentId
    ? ((await tx.department.findFirst({ where: { id: existing.parentDepartmentId } }))?.code ??
      null)
    : null;
  const resolvedParentCode = resolveFieldForWrite(n.parentCode, currentParentCode);
  if (resolvedParentCode !== currentParentCode) {
    const newParentId = resolvedParentCode
      ? await findDepartmentIdByCode(companyId, resolvedParentCode, tx)
      : null;
    await moveDepartment(
      { companyId, departmentId: existing.id, newParentDepartmentId: newParentId },
      tx
    );
  }

  if (n.status && n.status !== existing.status) {
    if (n.status === "INACTIVE") await archiveDepartment(existing.id, companyId, "SYSTEM", tx);
    else await reactivateDepartment(existing.id, companyId, "SYSTEM", tx);
  }
}

async function findPositionIdByCode(
  companyId: string,
  code: string,
  tx: DbClient
): Promise<string | null> {
  const pos = await tx.position.findFirst({ where: { companyId, positionCode: code } });
  return pos?.id ?? null;
}

async function findJobGradeIdByCode(
  companyId: string,
  code: string,
  tx: DbClient
): Promise<string | null> {
  const grade = await tx.jobGrade.findFirst({ where: { companyId, code } });
  return grade?.id ?? null;
}

async function applyPositionRow(
  companyId: string,
  row: RowPlanEntry<NormalizedPositionRow>,
  tx: DbClient
): Promise<void> {
  const n = row.normalized;
  if (!n) return;

  const departmentId = await findDepartmentIdByCode(companyId, n.departmentCode, tx);
  if (!departmentId) throw new NotFoundError("Department", n.departmentCode);

  if (row.action === "CREATE") {
    const jobGradeId =
      n.jobGradeCode.kind === "value"
        ? await findJobGradeIdByCode(companyId, n.jobGradeCode.value, tx)
        : null;
    const reportsToId =
      n.reportsToCode.kind === "value"
        ? await findPositionIdByCode(companyId, n.reportsToCode.value, tx)
        : null;
    await createPosition(
      {
        companyId,
        departmentId,
        jobGradeId,
        title: n.title,
        positionCode: n.code,
        description: resolveFieldForWrite(n.description, null),
        location: resolveFieldForWrite(n.location, null),
        primaryReportsToPositionId: reportsToId,
      },
      tx
    );
    return;
  }

  const existing = await tx.position.findFirst({ where: { companyId, positionCode: n.code } });
  if (!existing) throw new NotFoundError("Position", n.code);

  await updatePosition(
    {
      companyId,
      positionId: existing.id,
      title: n.title,
      description: resolveFieldForWrite(n.description, existing.description),
      location: resolveFieldForWrite(n.location, existing.location),
      departmentId,
      jobGradeId: resolveFieldForWrite(
        n.jobGradeCode.kind === "value"
          ? {
              kind: "value",
              value: await findJobGradeIdByCode(companyId, n.jobGradeCode.value, tx),
            }
          : n.jobGradeCode,
        existing.jobGradeId
      ),
    },
    tx
  );

  const currentReportsToCode = existing.primaryReportsToPositionId
    ? ((await tx.position.findFirst({ where: { id: existing.primaryReportsToPositionId } }))
        ?.positionCode ?? null)
    : null;
  const resolvedReportsToCode = resolveFieldForWrite(
    n.reportsToCode.kind === "value"
      ? { kind: "value", value: n.reportsToCode.value }
      : n.reportsToCode,
    currentReportsToCode
  );
  if (resolvedReportsToCode !== currentReportsToCode) {
    const newParentId = resolvedReportsToCode
      ? await findPositionIdByCode(companyId, resolvedReportsToCode, tx)
      : null;
    await movePosition(
      { companyId, positionId: existing.id, newParentPositionId: newParentId },
      tx
    );
  }

  if (n.status && n.status !== existing.status) {
    if (n.status === "INACTIVE") await archivePosition(existing.id, companyId, "SYSTEM", tx);
    else await activatePosition(existing.id, companyId, "SYSTEM", tx);
  }
}

async function applyEmployeeRow(
  companyId: string,
  row: RowPlanEntry<NormalizedEmployeeRow>,
  tx: DbClient
): Promise<void> {
  const n = row.normalized;
  if (!n) return;

  const toDate = (value: string | null): Date | null =>
    value ? new Date(`${value}T00:00:00.000Z`) : null;

  if (row.action === "CREATE") {
    await createEmployee(
      {
        companyId,
        employeeCode: n.code,
        firstName: n.firstName,
        lastName: n.lastName,
        preferredName: resolveFieldForWrite(n.preferredName, null),
        workEmail: resolveFieldForWrite(n.workEmail, null),
        joiningDate: toDate(resolveFieldForWrite(n.joiningDate, null)),
      },
      tx
    );
    return;
  }

  const existing = await tx.employee.findFirst({ where: { companyId, employeeCode: n.code } });
  if (!existing) throw new NotFoundError("Employee", n.code);

  await updateEmployee(
    {
      companyId,
      employeeId: existing.id,
      firstName: n.firstName,
      lastName: n.lastName,
      preferredName: resolveFieldForWrite(n.preferredName, existing.preferredName),
      workEmail: resolveFieldForWrite(n.workEmail, existing.workEmail),
      joiningDate: toDate(
        resolveFieldForWrite(
          n.joiningDate,
          existing.joiningDate ? existing.joiningDate.toISOString().slice(0, 10) : null
        )
      ),
      leavingDate: toDate(
        resolveFieldForWrite(
          n.leavingDate,
          existing.leavingDate ? existing.leavingDate.toISOString().slice(0, 10) : null
        )
      ),
    },
    tx
  );

  if (n.employmentStatus && n.employmentStatus !== existing.employmentStatus) {
    await changeEmployeeStatus(existing.id, companyId, n.employmentStatus, "SYSTEM", tx);
  }
}

async function applyAssignmentRow(
  companyId: string,
  row: RowPlanEntry<NormalizedAssignmentRow>,
  tx: DbClient
): Promise<void> {
  const n = row.normalized;
  if (!n) return;

  const toDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
  const employee = await tx.employee.findFirst({
    where: { companyId, employeeCode: n.employeeCode },
  });
  const position = await tx.position.findFirst({
    where: { companyId, positionCode: n.positionCode },
  });
  if (!employee) throw new NotFoundError("Employee", n.employeeCode);
  if (!position) throw new NotFoundError("Position", n.positionCode);

  if (n.operation === "ASSIGN") {
    if (!n.effectiveDate) return;
    await createAssignment(
      {
        companyId,
        employeeId: employee.id,
        positionId: position.id,
        startDate: toDate(n.effectiveDate),
      },
      tx
    );
  } else if (n.operation === "TRANSFER") {
    if (!n.effectiveDate) return;
    const currentAssignment = await tx.positionAssignment.findFirst({
      where: { companyId, employeeId: employee.id, isPrimary: true, endDate: null },
    });
    if (!currentAssignment)
      throw new NotFoundError("PositionAssignment (open, for employee)", n.employeeCode);
    await transferEmployee(
      {
        companyId,
        employeeId: employee.id,
        fromAssignmentId: currentAssignment.id,
        toPositionId: position.id,
        transferDate: toDate(n.effectiveDate),
      },
      tx
    );
  } else if (n.operation === "END_ASSIGNMENT") {
    if (!n.endDate) return;
    const currentAssignment = await tx.positionAssignment.findFirst({
      where: {
        companyId,
        employeeId: employee.id,
        positionId: position.id,
        isPrimary: true,
        endDate: null,
      },
    });
    if (!currentAssignment)
      throw new NotFoundError("PositionAssignment (open, for employee+position)", n.employeeCode);
    await endAssignment(currentAssignment.id, companyId, toDate(n.endDate), "SYSTEM", tx);
  }
}

export async function getImportJob(jobId: string, companyId: string): Promise<ImportJob> {
  return loadJobAndExpireIfStale(jobId, companyId, prisma);
}

export async function listImportJobs(companyId: string): Promise<ImportJob[]> {
  return listImportJobsForCompany(companyId);
}

export async function getImportRowIssues(jobId: string, companyId: string) {
  const job = await findImportJobById(jobId, companyId);
  if (!job) throw new NotFoundError("ImportJob", jobId);
  return listImportRowIssues(jobId);
}
