"use server";

import type { ImportJob, ImportRowIssue } from "@prisma/client";

import { requirePermission } from "@/lib/auth/current-user";
import { runAction, type ActionResult } from "@/lib/server/action-result";
import { DomainValidationError } from "@/lib/domain/errors";
import { generateImportTemplateCsv } from "@/lib/domain/import/templates";
import { generateImportErrorReportCsv } from "@/lib/domain/import/error-report";
import {
  cancelImportJob,
  confirmImportJob,
  executeImportJob,
  getImportJob,
  getImportRowIssues,
  listImportJobs,
  uploadImportFile,
  validateImportJob,
  type ExecuteImportResult,
} from "@/lib/services/import.service";
import {
  confirmImportSchema,
  downloadTemplateSchema,
  importJobIdSchema,
  importModeSchema,
  importTypeSchema,
} from "@/lib/validation/import";

const MAX_FILENAME_LENGTH = 255;

/**
 * Upload is a Server Action accepting `FormData` with a `File` — Next.js
 * Server Actions support this natively (see next.config.ts's comment),
 * keeping this consistent with every other mutation in the app rather
 * than introducing a separate route handler.
 *
 * Only Stage-1 checks that don't require the file's *content* happen
 * here (extension, non-empty, size) — everything content-shaped
 * (headers, row count, encoding) happens in `validateImportAction`,
 * which actually parses the file.
 */
export async function uploadImportAction(formData: FormData): Promise<ActionResult<ImportJob>> {
  return runAction(async () => {
    const user = await requirePermission("imports:execute");

    const file = formData.get("file");
    const importTypeRaw = formData.get("importType");
    const importModeRaw = formData.get("importMode");

    if (!(file instanceof File)) {
      throw new DomainValidationError("No file was uploaded.");
    }
    const importType = importTypeSchema.parse(importTypeRaw);
    const importMode = importModeSchema.parse(importModeRaw);

    // Never trust the extension or MIME type alone (Step 6) — this is a
    // first, cheap rejection for an obviously-wrong file; the real
    // content validation happens in validateImportAction.
    if (!file.name.toLowerCase().endsWith(".csv")) {
      throw new DomainValidationError("Only .csv files are accepted.");
    }
    if (file.name.length > MAX_FILENAME_LENGTH) {
      throw new DomainValidationError("The filename is too long.");
    }

    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    return uploadImportFile({
      companyId: user.companyId,
      userId: user.id,
      importType,
      importMode,
      originalFilename: file.name,
      fileBuffer,
    });
  });
}

export async function validateImportAction(input: unknown): Promise<ActionResult<ImportJob>> {
  return runAction(async () => {
    const user = await requirePermission("imports:execute");
    const { jobId } = importJobIdSchema.parse(input);
    return validateImportJob(jobId, user.companyId);
  });
}

export async function confirmImportAction(input: unknown): Promise<ActionResult<ImportJob>> {
  return runAction(async () => {
    const user = await requirePermission("imports:execute");
    const { jobId, acknowledgeWarnings } = confirmImportSchema.parse(input);
    return confirmImportJob(jobId, user.companyId, acknowledgeWarnings);
  });
}

export async function executeImportAction(
  input: unknown
): Promise<ActionResult<ExecuteImportResult>> {
  return runAction(async () => {
    const user = await requirePermission("imports:execute");
    const { jobId } = importJobIdSchema.parse(input);
    return executeImportJob(jobId, user.companyId);
  });
}

export async function cancelImportAction(input: unknown): Promise<ActionResult<ImportJob>> {
  return runAction(async () => {
    const user = await requirePermission("imports:execute");
    const { jobId } = importJobIdSchema.parse(input);
    return cancelImportJob(jobId, user.companyId);
  });
}

export async function getImportJobAction(input: unknown): Promise<ActionResult<ImportJob>> {
  return runAction(async () => {
    const user = await requirePermission("imports:execute");
    const { jobId } = importJobIdSchema.parse(input);
    return getImportJob(jobId, user.companyId);
  });
}

export async function listImportJobsAction(): Promise<ActionResult<ImportJob[]>> {
  return runAction(async () => {
    const user = await requirePermission("imports:execute");
    return listImportJobs(user.companyId);
  });
}

export async function getImportRowIssuesAction(
  input: unknown
): Promise<ActionResult<ImportRowIssue[]>> {
  return runAction(async () => {
    const user = await requirePermission("imports:execute");
    const { jobId } = importJobIdSchema.parse(input);
    return getImportRowIssues(jobId, user.companyId);
  });
}

export interface DownloadableCsv {
  filename: string;
  content: string;
}

export async function downloadImportTemplateAction(
  input: unknown
): Promise<ActionResult<DownloadableCsv>> {
  return runAction(async () => {
    await requirePermission("imports:execute");
    const { importType } = downloadTemplateSchema.parse(input);
    return generateImportTemplateCsv(importType);
  });
}

export async function downloadImportErrorReportAction(
  input: unknown
): Promise<ActionResult<DownloadableCsv>> {
  return runAction(async () => {
    const user = await requirePermission("imports:execute");
    const { jobId } = importJobIdSchema.parse(input);
    const issues = await getImportRowIssues(jobId, user.companyId);
    return {
      filename: `import-errors-${jobId}.csv`,
      content: generateImportErrorReportCsv(issues),
    };
  });
}
