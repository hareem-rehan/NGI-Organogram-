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
    positionCode: positionCodeSchema,
    departmentId: z.string().uuid(),
    jobGradeId: z.string().uuid().nullable().optional(),
    description: descriptionSchema,
    location: locationSchema,
    primaryReportsToPositionId: z.string().uuid().nullable().optional(),
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

export const positionStatusChangeSchema = z
  .object({
    positionId: z.string().uuid(),
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
