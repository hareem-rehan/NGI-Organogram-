import { z } from "zod";

import { JOB_GRADE_SCALE } from "@/lib/domain/job-grade-mapping";
import { careerTrackKindSchema } from "@/lib/validation/career-framework";

/**
 * Server-side validation for the Levels Mapping grid (department-scoped
 * level titles). As everywhere else, `companyId` is never a field — it is
 * derived from the authenticated session, never accepted from a client
 * payload. This models career PROGRESSION only and never sets or reads a
 * reporting relationship (docs/DECISIONS.md).
 */

const SCALE_CODES = JOB_GRADE_SCALE.map((s) => s.code) as [string, ...string[]];

const titleSchema = z
  .string()
  .trim()
  .min(1, "Level name is required.")
  .max(150, "Level name must be 150 characters or fewer.");

/** A level code must be one of the fixed standard scale codes (L2…L18). */
const jobGradeCodeSchema = z.enum(SCALE_CODES, { message: "Unknown level." });

export const createDepartmentLevelTitleSchema = z
  .object({
    departmentId: z.string().uuid(),
    jobGradeCode: jobGradeCodeSchema,
    kind: careerTrackKindSchema,
    title: titleSchema,
    displayOrder: z.number().int().nullable().optional(),
  })
  .strict();
export type CreateDepartmentLevelTitleValues = z.infer<typeof createDepartmentLevelTitleSchema>;

export const updateDepartmentLevelTitleSchema = z
  .object({
    id: z.string().uuid(),
    title: titleSchema,
  })
  .strict();
export type UpdateDepartmentLevelTitleValues = z.infer<typeof updateDepartmentLevelTitleSchema>;

export const deleteDepartmentLevelTitleSchema = z.object({ id: z.string().uuid() }).strict();
export type DeleteDepartmentLevelTitleValues = z.infer<typeof deleteDepartmentLevelTitleSchema>;
