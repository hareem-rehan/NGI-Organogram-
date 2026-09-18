import { z } from "zod";

/**
 * Server-side validation for organogram export actions. `companyId`/
 * `userId` are never fields here — always derived from the authenticated
 * session (docs/AUTHORIZATION_MATRIX.md), exactly like every other
 * domain's validation module. This schema only checks *shape*; the full
 * business validation (e.g. selectedPositionId required for
 * POSITION_FOCUS) happens in `resolveExportOptions`
 * (lib/domain/export/types.ts), which is the single source of truth for
 * that logic and is reused by both the request path and its tests.
 */
const exportFilterStateSchema = z
  .object({
    departmentIds: z.array(z.string().uuid()),
    levels: z.array(z.number().int().positive()),
    jobGradeIds: z.array(z.string().uuid().nullable()),
    occupancy: z.enum(["all", "occupied", "vacant"]),
    statuses: z.array(z.enum(["PLANNED", "ACTIVE", "INACTIVE"])),
  })
  .strict();

export const requestExportSchema = z
  .object({
    format: z.enum(["PDF", "PNG"]),
    scope: z.enum(["FULL_COMPANY", "CURRENT_VIEW", "POSITION_FOCUS", "DEPARTMENT_FOCUS"]),
    selectedPositionId: z.string().uuid().nullable().optional(),
    selectedDepartmentId: z.string().uuid().nullable().optional(),
    descendantDepth: z
      .union([z.literal(1), z.literal(2), z.literal(3), z.literal("all")])
      .optional(),
    includePlanned: z.boolean().optional(),
    filters: exportFilterStateSchema.optional(),
    pageSize: z.enum(["A4", "A3"]).optional(),
    pdfLayoutMode: z.enum(["AUTO", "SINGLE_PAGE", "MULTI_PAGE_TILED"]).optional(),
    pngScale: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    includeLegend: z.boolean().optional(),
    includeMetadata: z.boolean().optional(),
    includeConfidentialityLabel: z.boolean().optional(),
  })
  .strict();

export const exportJobIdSchema = z
  .object({
    jobId: z.string().uuid(),
  })
  .strict();
