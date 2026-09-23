import { z } from "zod";

/**
 * Server-side validation for the career framework (sub-divisions, career
 * tracks, level-mapping entries). As everywhere else, `companyId` is
 * never a field — it is derived from the authenticated session, never
 * accepted from a client payload.
 *
 * The career framework models career PROGRESSION and is deliberately
 * independent of the reporting hierarchy (docs/DECISIONS.md): nothing
 * here sets or reads a reporting relationship.
 */

const nameSchema = z
  .string()
  .trim()
  .min(1, "Name is required.")
  .max(150, "Name must be 150 characters or fewer.");

const codeSchema = z
  .string()
  .trim()
  .min(2, "Code must be at least 2 characters.")
  .max(30, "Code must be 30 characters or fewer.");

const descriptionSchema = z
  .string()
  .trim()
  .max(500, "Description must be 500 characters or fewer.")
  .nullable()
  .optional();

const titleSchema = z
  .string()
  .trim()
  .min(1, "Title is required.")
  .max(150, "Title must be 150 characters or fewer.");

export const careerTrackKindSchema = z.enum(["IC", "MANAGER"]);

// ── Sub-division ────────────────────────────────────────────────────────

export const createJobFamilySchema = z
  .object({
    departmentId: z.string().uuid(),
    name: nameSchema,
    code: codeSchema,
    description: descriptionSchema,
    displayOrder: z.number().int().nullable().optional(),
  })
  .strict();
export type CreateJobFamilyValues = z.infer<typeof createJobFamilySchema>;

export const updateJobFamilySchema = z
  .object({
    jobFamilyId: z.string().uuid(),
    name: nameSchema.optional(),
    code: codeSchema.optional(),
    description: descriptionSchema,
    displayOrder: z.number().int().nullable().optional(),
  })
  .strict();
export type UpdateJobFamilyValues = z.infer<typeof updateJobFamilySchema>;

export const deleteJobFamilySchema = z.object({ jobFamilyId: z.string().uuid() }).strict();

// ── Career track ──────────────────────────────────────────────────────

export const createCareerTrackSchema = z
  .object({
    jobFamilyId: z.string().uuid(),
    kind: careerTrackKindSchema,
    name: nameSchema.optional(),
    displayOrder: z.number().int().nullable().optional(),
  })
  .strict();
export type CreateCareerTrackValues = z.infer<typeof createCareerTrackSchema>;

export const deleteCareerTrackSchema = z.object({ careerTrackId: z.string().uuid() }).strict();

// ── Level-mapping entry (a matrix cell → eligible title) ──────────────

export const createLevelMappingEntrySchema = z
  .object({
    jobFamilyId: z.string().uuid(),
    // Optional: omitted in single-ladder mode, where the family's default
    // (IC) ladder is used. Provided only to target a specific ladder.
    careerTrackId: z.string().uuid().optional(),
    jobGradeId: z.string().uuid(),
    title: titleSchema,
    displayOrder: z.number().int().nullable().optional(),
  })
  .strict();
export type CreateLevelMappingEntryValues = z.infer<typeof createLevelMappingEntrySchema>;

export const addManagerLadderSchema = z.object({ jobFamilyId: z.string().uuid() }).strict();
export type AddManagerLadderValues = z.infer<typeof addManagerLadderSchema>;

export const deleteLevelMappingEntrySchema = z
  .object({ levelMappingEntryId: z.string().uuid() })
  .strict();
