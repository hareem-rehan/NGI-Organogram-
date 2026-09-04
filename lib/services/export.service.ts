import "server-only";
import type { ExportJob, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { computeElkLayout } from "@/app/(app)/organogram/_lib/elk-layout";
import { DomainValidationError, NotFoundError, UnsafeMutationError } from "@/lib/domain/errors";
import {
  ExportOptionsError,
  MAX_EXPORT_NODE_COUNT,
  resolveExportOptions,
  type ExportOptionsInput,
  type ResolvedExportOptions,
} from "@/lib/domain/export/types";
import { buildExportSubgraph } from "@/lib/domain/export/subgraph";
import { renderOrganogramSvg, type SvgLegendDepartment } from "@/lib/domain/export/svg-renderer";
import {
  assertPngWithinSafeRenderBudget,
  PngPerformanceLimitError,
  PngSizeError,
  renderSvgToPng,
} from "@/lib/domain/export/png-renderer";
import { PdfPageLimitError, renderOrganogramPdf } from "@/lib/domain/export/pdf-renderer";
import { getOrganogramData } from "@/lib/services/organogram.service";
import { recordAuditEvent } from "@/lib/services/audit.service";
import type { DbClient } from "@/lib/repositories/types";
import {
  createExportJob,
  findExportJobById,
  listExportJobsForCompany,
  updateExportJob,
} from "@/lib/repositories/export.repository";

/** Generated files are retained only long enough to be downloaded, mirroring `IMPORT_RETENTION_DAYS`'s Phase 10 precedent (docs/DECISIONS.md). */
export const EXPORT_RETENTION_DAYS = 7;

/**
 * Statuses with no generated file bytes left to protect and no further
 * transition possible. Deliberately does NOT include COMPLETED — unlike
 * `import.service.ts`'s retention window (which bounds how long an
 * unexecuted upload stays actionable), an export's retention window
 * bounds how long its ALREADY-GENERATED file stays downloadable, so a
 * COMPLETED job must still be eligible to lazily expire (clearing
 * `generatedFile`) once `expiresAt` lapses, and must still be eligible
 * for early cancellation (freeing the bytes before the window lapses).
 */
const NO_FILE_STATUSES = new Set(["FAILED", "CANCELLED", "EXPIRED"]);

function isExpired(job: ExportJob): boolean {
  return job.expiresAt.getTime() < Date.now();
}

/**
 * A job past its retention window is treated as EXPIRED on the next read
 * that touches it — same lazy-expiry rationale as
 * `import.service.ts`'s `loadJobAndExpireIfStale` (no background job
 * scheduler in this app).
 */
async function loadJobAndExpireIfStale(
  jobId: string,
  companyId: string,
  db: DbClient
): Promise<ExportJob> {
  const job = await findExportJobById(jobId, companyId, db);
  if (!job) throw new NotFoundError("ExportJob", jobId);
  if (!NO_FILE_STATUSES.has(job.status) && isExpired(job)) {
    return updateExportJob(job.id, { status: "EXPIRED", generatedFile: null }, db);
  }
  return job;
}

function scopeLabelFor(
  resolved: ResolvedExportOptions,
  allNodes: readonly {
    positionId: string;
    title: string;
    departmentId: string;
    departmentName: string;
  }[]
): string {
  if (resolved.scope === "POSITION_FOCUS") {
    const target = allNodes.find((n) => n.positionId === resolved.selectedPositionId);
    return target ? `${target.title} — Position Focus` : "Position Focus";
  }
  if (resolved.scope === "DEPARTMENT_FOCUS") {
    const target = allNodes.find((n) => n.departmentId === resolved.selectedDepartmentId);
    return target ? `${target.departmentName} — Department Focus` : "Department Focus";
  }
  if (resolved.scope === "CURRENT_VIEW") return "Current View";
  return "Full Company";
}

function sanitizeForFilename(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

export interface RequestExportInput {
  companyId: string;
  userId: string;
  options: ExportOptionsInput;
}

/**
 * The single entry point for a user-requested export. Fully synchronous
 * within one request — there is no background job queue in this app
 * (same documented constraint as Phase 10's import execution), so a
 * created job passes through QUEUED → PROCESSING → COMPLETED/FAILED
 * before this function returns. The row is still modeled with those
 * states (rather than skipping straight to a result) so the schema and
 * UI are forward-compatible with a future async worker without a
 * migration, per CLAUDE.md §5's "safest reversible default."
 *
 * Reuses `getOrganogramData` (the exact same company-scoped, safety-
 * filtered read the interactive chart uses), `buildExportSubgraph`
 * (Phase 9's own focus/filter functions), and `computeElkLayout` (the
 * interactive chart's own layout engine) — never an independent
 * recalculation of hierarchy or layout (organogram-hierarchy-safety
 * skill / docs/adr/0013).
 */
export async function requestExport(input: RequestExportInput): Promise<ExportJob> {
  let resolved: ResolvedExportOptions;
  try {
    resolved = resolveExportOptions(input.options);
  } catch (error) {
    if (error instanceof ExportOptionsError) {
      throw new DomainValidationError(error.message);
    }
    throw error;
  }

  const organogram = await getOrganogramData({ companyId: input.companyId });

  const subgraph = buildExportSubgraph(organogram.nodes, organogram.edges, {
    scope: resolved.scope,
    selectedPositionId: resolved.selectedPositionId,
    selectedDepartmentId: resolved.selectedDepartmentId,
    descendantDepth: resolved.descendantDepth,
    includePlanned: resolved.includePlanned,
    filters: resolved.filters,
  });

  if (subgraph.focusTargetMissing) {
    throw new NotFoundError(
      resolved.scope === "DEPARTMENT_FOCUS" ? "Department" : "Position",
      resolved.selectedPositionId ?? resolved.selectedDepartmentId ?? "unknown"
    );
  }

  // Defensive-only under the current schema: `getOrganogramData` already
  // caps the underlying position read at 2000
  // (organogram.repository.ts), below MAX_EXPORT_NODE_COUNT, so this can
  // never fire via real data today — it exists so a future increase to
  // that read cap can't silently reintroduce an unbounded export without
  // also raising this limit deliberately. The actual scaling risk for a
  // WIDE graph (many siblings) is separately guarded by
  // pdf-renderer.ts's `MAX_PDF_TILE_PAGES` and png-renderer.ts's pixel
  // limits, both of which real exports do hit.
  if (subgraph.nodes.length > MAX_EXPORT_NODE_COUNT) {
    throw new UnsafeMutationError(
      `This export would include ${subgraph.nodes.length} positions, which exceeds the maximum of ${MAX_EXPORT_NODE_COUNT} supported in one export. Narrow the scope (a department or position focus) and try again.`
    );
  }

  const scopeLabel = scopeLabelFor(resolved, organogram.nodes);
  const expiresAt = new Date(Date.now() + EXPORT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  // Layout and SVG rendering happen BEFORE the ExportJob row is created
  // (Phase 13.1, DEF-010 remediation, Step 9.6: "do not queue a PNG job
  // known to exceed limits") — this is cheap relative to PNG rasterization
  // itself and gives the real, post-layout pixel dimensions needed to
  // check `assertPngWithinSafeRenderBudget` below before committing to a
  // job at all.
  const positions = await computeElkLayout(
    subgraph.nodes.map((n) => n.positionId),
    subgraph.edges
  );

  const departmentsById = new Map<string, SvgLegendDepartment>();
  for (const node of subgraph.nodes) {
    if (!departmentsById.has(node.departmentId)) {
      departmentsById.set(node.departmentId, {
        id: node.departmentId,
        name: node.departmentName,
        color: node.departmentColor,
      });
    }
  }

  const svgResult = renderOrganogramSvg(
    subgraph.nodes.map((n) => ({
      positionId: n.positionId,
      title: n.title,
      positionCode: n.positionCode,
      departmentName: n.departmentName,
      departmentColor: n.departmentColor,
      organizationalLevel: n.organizationalLevel,
      jobGradeName: n.jobGradeName,
      occupancyStatus: n.occupancyStatus,
      occupantDisplayName: n.occupantDisplayName,
      positionStatus: n.positionStatus,
      matchState: n.matchState,
    })),
    subgraph.edges,
    positions,
    {
      companyName: organogram.company.name,
      effectiveDate: organogram.company.effectiveDate,
      scopeLabel,
      focusLabel:
        resolved.scope === "POSITION_FOCUS" || resolved.scope === "DEPARTMENT_FOCUS"
          ? scopeLabel
          : null,
      filtersSummary: null,
      generatedAtLabel: new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC",
    },
    {
      includeLegend: resolved.includeLegend,
      includeMetadata: resolved.includeMetadata,
      includeConfidentialityLabel: resolved.includeConfidentialityLabel,
      departments: [...departmentsById.values()],
    }
  );

  if (resolved.format === "PNG") {
    try {
      assertPngWithinSafeRenderBudget(
        svgResult.totalWidth,
        svgResult.totalHeight,
        resolved.pngScale
      );
    } catch (error) {
      if (error instanceof PngPerformanceLimitError) {
        throw new DomainValidationError(error.message);
      }
      throw error;
    }
  }

  const job = await createExportJob({
    companyId: input.companyId,
    requestedByUserId: input.userId,
    format: resolved.format,
    scope: resolved.scope,
    optionsSnapshot: JSON.parse(JSON.stringify(resolved)) as Prisma.InputJsonValue,
    scopeLabel,
    expiresAt,
  });

  await updateExportJob(job.id, { status: "PROCESSING", nodeCount: subgraph.nodes.length });

  const actor = { userId: input.userId, displayName: null, email: null };
  await recordAuditEvent({
    companyId: input.companyId,
    actor,
    action: "EXPORT_REQUESTED",
    category: "EXPORT",
    entityType: "ExportJob",
    entityId: job.id,
    correlationId: job.id,
    exportJobId: job.id,
    metadata: { format: resolved.format, scope: resolved.scope, nodeCount: subgraph.nodes.length },
  });

  try {
    const baseFilename = `organogram-${sanitizeForFilename(organogram.company.code)}-${sanitizeForFilename(scopeLabel)}-${organogram.company.effectiveDate}`;

    if (resolved.format === "PNG") {
      let png;
      try {
        png = await renderSvgToPng(
          svgResult.svg,
          svgResult.totalWidth,
          svgResult.totalHeight,
          resolved.pngScale
        );
      } catch (error) {
        if (error instanceof PngSizeError) {
          throw new DomainValidationError(`${error.message}`);
        }
        throw error;
      }
      const completed = await updateExportJob(job.id, {
        status: "COMPLETED",
        generatedFile: new Uint8Array(png.buffer),
        generatedFilename: `${baseFilename}.png`,
        fileSize: png.buffer.length,
        pageCount: null,
        completedAt: new Date(),
      });
      await recordAuditEvent({
        companyId: input.companyId,
        actor,
        action: "EXPORT_COMPLETED",
        category: "EXPORT",
        entityType: "ExportJob",
        entityId: completed.id,
        correlationId: job.id,
        exportJobId: completed.id,
        metadata: { format: "PNG", fileSize: png.buffer.length },
      });
      return completed;
    }

    let pdf;
    try {
      pdf = await renderOrganogramPdf(svgResult, resolved.pageSize, resolved.pdfLayoutMode, {
        companyName: organogram.company.name,
        scopeLabel,
        effectiveDate: organogram.company.effectiveDate,
        generatedAtLabel: new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC",
      });
    } catch (error) {
      if (error instanceof PdfPageLimitError) {
        throw new DomainValidationError(error.message);
      }
      throw error;
    }

    const completed = await updateExportJob(job.id, {
      status: "COMPLETED",
      generatedFile: new Uint8Array(pdf.buffer),
      generatedFilename: `${baseFilename}.pdf`,
      fileSize: pdf.buffer.length,
      pageCount: pdf.pageCount,
      completedAt: new Date(),
    });
    await recordAuditEvent({
      companyId: input.companyId,
      actor,
      action: "EXPORT_COMPLETED",
      category: "EXPORT",
      entityType: "ExportJob",
      entityId: completed.id,
      correlationId: job.id,
      exportJobId: completed.id,
      metadata: { format: "PDF", fileSize: pdf.buffer.length, pageCount: pdf.pageCount },
    });
    return completed;
  } catch (error) {
    const safeMessage =
      error instanceof DomainValidationError || error instanceof UnsafeMutationError
        ? error.message
        : "The export could not be generated. Please try again.";
    await updateExportJob(job.id, {
      status: "FAILED",
      errorMessage: safeMessage,
      generatedFile: null,
    });
    await recordAuditEvent({
      companyId: input.companyId,
      actor,
      action: "EXPORT_FAILED",
      category: "EXPORT",
      entityType: "ExportJob",
      entityId: job.id,
      correlationId: job.id,
      exportJobId: job.id,
      metadata: { reason: safeMessage },
    });
    throw error;
  }
}

export type SafeExportJob = Omit<ExportJob, "generatedFile">;

/** Strips the (potentially large) file bytes before a job crosses any boundary that doesn't need them — the Server Action layer, the job-status/list reads. Never used for the download path itself, which reads `generatedFile` directly. */
export function omitGeneratedFile(job: ExportJob): SafeExportJob {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructuring is the concise way to omit one field; the discarded binding is never read on purpose.
  const { generatedFile, ...safe } = job;
  return safe;
}

export async function getExportJob(jobId: string, companyId: string): Promise<SafeExportJob> {
  const job = await loadJobAndExpireIfStale(jobId, companyId, prisma);
  return omitGeneratedFile(job);
}

export async function listExportJobs(companyId: string): Promise<SafeExportJob[]> {
  const jobs = await listExportJobsForCompany(companyId);
  return jobs.map(omitGeneratedFile);
}

export interface DownloadableExportFile {
  filename: string;
  buffer: Buffer;
  contentType: "application/pdf" | "image/png";
}

/**
 * Re-checks the job's own status/expiry on every download rather than
 * trusting that a caller who knows the job id is automatically
 * authorized — the caller must additionally already be company-scoped
 * via `loadJobAndExpireIfStale`'s `findExportJobById(id, companyId)`
 * query, so a job id from another company never resolves at all
 * (CLAUDE.md §1.8).
 */
export async function downloadExportFile(
  jobId: string,
  companyId: string
): Promise<DownloadableExportFile> {
  const job = await loadJobAndExpireIfStale(jobId, companyId, prisma);
  if (job.status !== "COMPLETED" || !job.generatedFile || !job.generatedFilename) {
    throw new NotFoundError("ExportJob file", jobId);
  }
  return {
    filename: job.generatedFilename,
    buffer: Buffer.from(job.generatedFile),
    contentType: job.format === "PDF" ? "application/pdf" : "image/png",
  };
}

/** Frees the stored bytes early without waiting for the retention window — a no-op (not an error) once the job already has no bytes to free. */
export async function cancelExportJob(jobId: string, companyId: string): Promise<ExportJob> {
  const job = await loadJobAndExpireIfStale(jobId, companyId, prisma);
  if (NO_FILE_STATUSES.has(job.status)) return job;
  return updateExportJob(job.id, { status: "CANCELLED", generatedFile: null });
}
