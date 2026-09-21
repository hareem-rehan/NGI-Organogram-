/**
 * Shared types and option validation for Phase 11's organogram export
 * pipeline (docs/adr/0013-organogram-export-rendering.md,
 * docs/ORGANOGRAM_EXPORT_GUIDE.md). Pure, DOM/Node-agnostic — no Prisma,
 * no sharp/pdfkit import here.
 */

export type ExportFormat = "PDF" | "PNG";
export type ExportScope = "FULL_COMPANY" | "CURRENT_VIEW" | "POSITION_FOCUS" | "DEPARTMENT_FOCUS";
export type PdfPageSize = "A4" | "A3";
export type PdfLayoutMode = "AUTO" | "SINGLE_PAGE" | "MULTI_PAGE_TILED";
export type PngScale = 1 | 2 | 3;
export type DescendantDepth = 1 | 2 | 3 | "all";

export interface ExportFilterState {
  departmentIds: readonly string[];
  levels: readonly number[];
  jobGradeIds: readonly (string | null)[];
  occupancy: "all" | "occupied" | "vacant";
  statuses: readonly ("PLANNED" | "ACTIVE" | "INACTIVE")[];
}

export interface ExportOptionsInput {
  format: ExportFormat;
  scope: ExportScope;
  selectedPositionId?: string | null;
  selectedDepartmentId?: string | null;
  descendantDepth?: DescendantDepth;
  includePlanned?: boolean;
  filters?: ExportFilterState;
  pageSize?: PdfPageSize;
  pdfLayoutMode?: PdfLayoutMode;
  pngScale?: PngScale;
  includeLegend?: boolean;
  includeMetadata?: boolean;
  includeConfidentialityLabel?: boolean;
}

/** Every field resolved to its concrete default — what the renderer actually consumes. */
export interface ResolvedExportOptions {
  format: ExportFormat;
  scope: ExportScope;
  selectedPositionId: string | null;
  selectedDepartmentId: string | null;
  descendantDepth: DescendantDepth;
  includePlanned: boolean;
  filters: ExportFilterState;
  pageSize: PdfPageSize;
  pdfLayoutMode: PdfLayoutMode;
  pngScale: PngScale;
  includeLegend: boolean;
  includeMetadata: boolean;
  includeConfidentialityLabel: boolean;
}

export const EXPORT_FORMATS: readonly ExportFormat[] = ["PDF", "PNG"];
export const EXPORT_SCOPES: readonly ExportScope[] = [
  "FULL_COMPANY",
  "CURRENT_VIEW",
  "POSITION_FOCUS",
  "DEPARTMENT_FOCUS",
];
export const PDF_PAGE_SIZES: readonly PdfPageSize[] = ["A4", "A3"];
export const PDF_LAYOUT_MODES: readonly PdfLayoutMode[] = [
  "AUTO",
  "SINGLE_PAGE",
  "MULTI_PAGE_TILED",
];
export const PNG_SCALES: readonly PngScale[] = [1, 2, 3];
export const DESCENDANT_DEPTHS: readonly DescendantDepth[] = [1, 2, 3, "all"];

/**
 * Generous vs. the ~2,000-position company scale (docs/DECISIONS.md P7) —
 * a defensive ceiling, not a realistic target. Applies to the NODE COUNT
 * being rendered, independent of pixel dimensions (see PNG limits below).
 */
export const MAX_EXPORT_NODE_COUNT = 2500;

/** PNG dimension/pixel ceilings — chosen to keep server memory bounded (Step 8's "reject or redirect oversized requests to PDF"). */
export const MAX_PNG_DIMENSION_PX = 20000;
export const MAX_PNG_TOTAL_PIXELS = 100_000_000; // 100 megapixels

/**
 * A rough CLIENT-SIDE-ONLY heuristic (Phase 13.1, DEF-010 remediation)
 * for warning the user before they even click "Generate export" — NOT
 * the authoritative check. The real, enforced limit is
 * `lib/domain/export/png-renderer.ts`'s `MAX_PNG_SAFE_TOTAL_PIXELS`,
 * applied server-side to the actual post-layout pixel dimensions
 * (`export.service.ts`, before an `ExportJob` row is even created) — a
 * client-side estimate can't know the real layout dimensions in advance
 * (they depend on hierarchy shape, not just node count), so this exists
 * only to proactively guide the user, never to gate the request itself.
 * At 1x scale, ~250 nodes is roughly where real measured renders start
 * risking the safe render-time budget (see
 * docs/PERFORMANCE_REPORT.md/docs/phase-reports/PHASE_13_1_PERFORMANCE_REMEDIATION.md);
 * since total pixels scale with the SQUARE of PNG scale for the same
 * layout, the safe node-count estimate shrinks by the same factor at
 * higher scales.
 */
export const PNG_SAFE_NODE_COUNT_ESTIMATE_AT_1X = 250;

export function estimatePngSafeNodeCount(scale: PngScale): number {
  return Math.floor(PNG_SAFE_NODE_COUNT_ESTIMATE_AT_1X / (scale * scale));
}

export class ExportOptionsError extends Error {
  constructor(
    message: string,
    public readonly field: string
  ) {
    super(message);
    this.name = "ExportOptionsError";
  }
}

/**
 * Validates and resolves a raw export-options input into a fully
 * defaulted `ResolvedExportOptions`, throwing `ExportOptionsError` for
 * anything invalid. Mirrors the "safest reversible default" pattern
 * `lib/domain/organogram-url-state.ts` already established — every
 * field is checked independently, one invalid field never invalidates
 * the whole request silently (it throws, naming exactly which field).
 */
export function resolveExportOptions(input: ExportOptionsInput): ResolvedExportOptions {
  if (!EXPORT_FORMATS.includes(input.format)) {
    throw new ExportOptionsError(`Unsupported export format: ${String(input.format)}.`, "format");
  }
  if (!EXPORT_SCOPES.includes(input.scope)) {
    throw new ExportOptionsError(`Unsupported export scope: ${String(input.scope)}.`, "scope");
  }

  if (input.scope === "POSITION_FOCUS") {
    if (!input.selectedPositionId || typeof input.selectedPositionId !== "string") {
      throw new ExportOptionsError(
        "selectedPositionId is required for POSITION_FOCUS scope.",
        "selectedPositionId"
      );
    }
  }
  if (input.scope === "DEPARTMENT_FOCUS") {
    if (!input.selectedDepartmentId || typeof input.selectedDepartmentId !== "string") {
      throw new ExportOptionsError(
        "selectedDepartmentId is required for DEPARTMENT_FOCUS scope.",
        "selectedDepartmentId"
      );
    }
  }

  const descendantDepth = input.descendantDepth ?? 2;
  if (!DESCENDANT_DEPTHS.includes(descendantDepth)) {
    throw new ExportOptionsError(
      `Invalid descendantDepth: ${String(descendantDepth)}.`,
      "descendantDepth"
    );
  }

  const pageSize = input.pageSize ?? "A3";
  if (!PDF_PAGE_SIZES.includes(pageSize)) {
    throw new ExportOptionsError(`Unsupported PDF page size: ${String(pageSize)}.`, "pageSize");
  }

  const pdfLayoutMode = input.pdfLayoutMode ?? "AUTO";
  if (!PDF_LAYOUT_MODES.includes(pdfLayoutMode)) {
    throw new ExportOptionsError(
      `Unsupported PDF layout mode: ${String(pdfLayoutMode)}.`,
      "pdfLayoutMode"
    );
  }

  const pngScale = input.pngScale ?? 2;
  if (!PNG_SCALES.includes(pngScale)) {
    throw new ExportOptionsError(`Unsupported PNG scale: ${String(pngScale)}.`, "pngScale");
  }

  const filters: ExportFilterState = input.filters ?? {
    departmentIds: [],
    levels: [],
    jobGradeIds: [],
    occupancy: "all",
    statuses: [],
  };
  if (!["all", "occupied", "vacant"].includes(filters.occupancy)) {
    throw new ExportOptionsError(
      `Invalid occupancy filter: ${String(filters.occupancy)}.`,
      "filters.occupancy"
    );
  }
  for (const status of filters.statuses) {
    if (!["PLANNED", "ACTIVE", "INACTIVE"].includes(status)) {
      throw new ExportOptionsError(
        `Invalid status filter value: ${String(status)}.`,
        "filters.statuses"
      );
    }
  }

  return {
    format: input.format,
    scope: input.scope,
    selectedPositionId:
      input.scope === "POSITION_FOCUS" ? (input.selectedPositionId ?? null) : null,
    selectedDepartmentId:
      input.scope === "DEPARTMENT_FOCUS" ? (input.selectedDepartmentId ?? null) : null,
    descendantDepth,
    includePlanned: input.includePlanned ?? true,
    filters,
    pageSize,
    pdfLayoutMode,
    pngScale,
    includeLegend: input.includeLegend ?? true,
    includeMetadata: input.includeMetadata ?? true,
    includeConfidentialityLabel: input.includeConfidentialityLabel ?? true,
  };
}
