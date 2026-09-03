"use server";

import { requirePermission } from "@/lib/auth/current-user";
import { runAction, type ActionResult } from "@/lib/server/action-result";
import {
  cancelExportJob,
  downloadExportFile,
  getExportJob,
  listExportJobs,
  omitGeneratedFile,
  requestExport,
  type SafeExportJob,
} from "@/lib/services/export.service";
import { exportJobIdSchema, requestExportSchema } from "@/lib/validation/export";

export type { SafeExportJob };

/**
 * Requests a new export. Fully synchronous (see export.service.ts) —
 * the returned job is already COMPLETED or FAILED by the time this
 * resolves, but the client still polls `getExportJobAction` the same
 * way it would for a future async worker (CLAUDE.md §5's "safest
 * reversible default").
 */
export async function requestExportAction(input: unknown): Promise<ActionResult<SafeExportJob>> {
  return runAction(async () => {
    const user = await requirePermission("exports:execute");
    const options = requestExportSchema.parse(input);
    const job = await requestExport({ companyId: user.companyId, userId: user.id, options });
    return omitGeneratedFile(job);
  });
}

export async function getExportJobAction(input: unknown): Promise<ActionResult<SafeExportJob>> {
  return runAction(async () => {
    const user = await requirePermission("exports:execute");
    const { jobId } = exportJobIdSchema.parse(input);
    return getExportJob(jobId, user.companyId);
  });
}

export async function listExportJobsAction(): Promise<ActionResult<SafeExportJob[]>> {
  return runAction(async () => {
    const user = await requirePermission("exports:execute");
    return listExportJobs(user.companyId);
  });
}

export async function cancelExportJobAction(input: unknown): Promise<ActionResult<SafeExportJob>> {
  return runAction(async () => {
    const user = await requirePermission("exports:execute");
    const { jobId } = exportJobIdSchema.parse(input);
    const job = await cancelExportJob(jobId, user.companyId);
    return omitGeneratedFile(job);
  });
}

export interface DownloadableExport {
  filename: string;
  contentType: string;
  /** Base64-encoded file bytes — Server Actions serialize return values as JSON, so binary content crosses the boundary as base64 and the client decodes it into a Blob before triggering a save. */
  base64: string;
}

/**
 * Re-authorizes on every download (never trusts a previously-seen job id
 * alone) — `downloadExportFile` re-runs the same company-scoped,
 * status/expiry-checked lookup `getExportJobAction` uses, so a stale or
 * cross-company job id never returns bytes (CLAUDE.md §1.8).
 */
export async function downloadExportFileAction(
  input: unknown
): Promise<ActionResult<DownloadableExport>> {
  return runAction(async () => {
    const user = await requirePermission("exports:execute");
    const { jobId } = exportJobIdSchema.parse(input);
    const file = await downloadExportFile(jobId, user.companyId);
    return {
      filename: file.filename,
      contentType: file.contentType,
      base64: file.buffer.toString("base64"),
    };
  });
}
