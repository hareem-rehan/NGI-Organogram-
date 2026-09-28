import { z } from "zod";

import { pageSchema, pageSizeSchema, searchQuerySchema } from "@/lib/validation/pagination";

/**
 * Server-side validation for position mutations
 * (docs/DATA_DICTIONARY.md "Position"). `companyId` and
 * `organizationalLevel` are deliberately NOT fields here —
 * `organizationalLevel` is always server-computed
 * (lib/services/hierarchy.service.ts), never client-settable, and
 * `companyId` always comes from the authenticated session.
 */
const titleSchema = z
  .string()
  .trim()
  .min(1, "Title is required.")
  .max(150, "Title must be 150 characters or fewer.");

const positionCodeSchema = z
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

const locationSchema = z
  .string()
  .trim()
  .max(100, "Location must be 100 characters or fewer.")
  .nullable()
  .optional();

export const createPositionSchema = z
  .object({
    title: titleSchema,
    // Optional from the form: it is auto-generated server-side when
    // absent (the field was removed from the UI — see the position form).
    positionCode: positionCodeSchema.optional(),
    departmentId: z.string().uuid(),
    jobGradeId: z.string().uuid().nullable().optional(),
    /**
     * A level code such as "L7" chosen in the form. The action resolves
     * it to a job-grade id (creating the grade from the standard scale if
     * it does not exist yet — see lib/services/job-grade.service.ts), so
     * a level can be set at creation time on a company with no grades set
     * up. `jobGradeId` stays supported for callers (imports, tests) that
     * already hold a resolved id.
     */
    jobGradeCode: z.string().trim().min(1).max(16).nullable().optional(),
    /** Display name for the chosen level, scoped to the position's department. */
    jobGradeName: z.string().trim().max(80).nullable().optional(),
    /**
     * Career-framework classification (both optional). Presentational to
     * the reporting tree — the organogram never reads them. See
     * docs/DECISIONS.md.
     */
    jobFamilyId: z.string().uuid().nullable().optional(),
    careerTrackId: z.string().uuid().nullable().optional(),
    /**
     * A plain IC/Manager choice from the Position form. The action resolves
     * it to a career-track id for the chosen sub-division, creating the track
     * if it does not exist yet — so a track can be set without pre-configuring
     * Career Framework. `careerTrackId` stays supported for callers holding a
     * resolved id.
     */
    careerTrackKind: z.enum(["IC", "MANAGER"]).nullable().optional(),
    description: descriptionSchema,
    location: locationSchema,
    primaryReportsToPositionId: z.string().uuid().nullable().optional(),
    /** Optional second head (docs/DECISIONS.md D27); rules re-checked in the service. */
    coReportsToPositionId: z.string().uuid().nullable().optional(),
  })
  .strict();
export type CreatePositionValues = z.infer<typeof createPositionSchema>;

export const updatePositionSchema = z
  .object({
    positionId: z.string().uuid(),
    title: titleSchema.optional(),
    positionCode: positionCodeSchema.optional(),
    departmentId: z.string().uuid().optional(),
    jobGradeId: z.string().uuid().nullable().optional(),
    /**
     * A level code such as "L7" chosen in the form. The action resolves
     * it to a job-grade id (creating the grade from the standard scale if
     * it does not exist yet — see lib/services/job-grade.service.ts), so
     * a level can be set at creation time on a company with no grades set
     * up. `jobGradeId` stays supported for callers (imports, tests) that
     * already hold a resolved id.
     */
    jobGradeCode: z.string().trim().min(1).max(16).nullable().optional(),
    /** Display name for the chosen level, scoped to the position's department. */
    jobGradeName: z.string().trim().max(80).nullable().optional(),
    /** Career-framework classification (both optional; never affects reporting). */
    jobFamilyId: z.string().uuid().nullable().optional(),
    careerTrackId: z.string().uuid().nullable().optional(),
    /** Plain IC/Manager choice; resolved to a track id (created if needed) by the action. */
    careerTrackKind: z.enum(["IC", "MANAGER"]).nullable().optional(),
    description: descriptionSchema,
    location: locationSchema,
  })
  .strict();
export type UpdatePositionValues = z.infer<typeof updatePositionSchema>;

export const movePositionSchema = z
  .object({
    positionId: z.string().uuid(),
    newParentPositionId: z.string().uuid().nullable(),
  })
  .strict();

/**
 * The "Change Reports-To" dialog's save: both reporting lines at once
 * (docs/DECISIONS.md D27). Head 1 null = make root; head 2 null = none.
 */
export const changeReportsToSchema = z
  .object({
    positionId: z.string().uuid(),
    newParentPositionId: z.string().uuid().nullable(),
    coReportsToPositionId: z.string().uuid().nullable(),
  })
  .strict();

/** Drop a position (and its branch) onto a department heading (docs/DECISIONS.md D29). */
export const movePositionToDepartmentSchema = z
  .object({
    positionId: z.string().uuid(),
    departmentId: z.string().uuid(),
  })
  .strict();

export const positionStatusChangeSchema = z
  .object({
    positionId: z.string().uuid(),
  })
  .strict();

/** Separate schema for the destructive path, so it can never widen by accident. */
export const deletePositionSchema = z
  .object({
    positionId: z.string().uuid(),
  })
  .strict();

/**
 * Sets a position's current occupant. `employeeId` null means "leave vacant".
 */
export const setPositionOccupantSchema = z
  .object({
    positionId: z.string().uuid(),
    employeeId: z.string().uuid().nullable(),
  })
  .strict();

/**
 * A non-empty, de-duplicated set of position ids for a bulk action. Capped so
 * one request can never fan out into an unbounded number of per-item
 * transactions (docs/DECISIONS.md P7 large-data guard).
 */
const bulkPositionIds = z
  .array(z.string().uuid())
  .min(1, "Select at least one position.")
  .max(200, "Select at most 200 positions at a time.")
  .transform((ids) => [...new Set(ids)]);

export const bulkPositionIdsSchema = z.object({ positionIds: bulkPositionIds }).strict();

export const bulkMovePositionsSchema = z
  .object({
    positionIds: bulkPositionIds,
    newParentPositionId: z.string().uuid().nullable(),
  })
  .strict();

export const listPositionsQuerySchema = z
  .object({
    search: searchQuerySchema,
    departmentId: z.string().uuid().optional(),
    status: z.enum(["PLANNED", "ACTIVE", "INACTIVE"]).optional(),
    occupancy: z.enum(["occupied", "vacant"]).optional(),
    page: pageSchema,
    pageSize: pageSizeSchema,
  })
  .strict();
export type ListPositionsQuery = z.infer<typeof listPositionsQuerySchema>;
