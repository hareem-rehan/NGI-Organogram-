import { z } from "zod";

import { pageSchema, pageSizeSchema, searchQuerySchema } from "@/lib/validation/pagination";

/**
 * Server-side validation for department mutations
 * (docs/DATA_DICTIONARY.md "Department"). `companyId` is deliberately
 * NOT a field here — it is always derived from the authenticated
 * session (lib/auth/current-user.ts's getAuthorizedCompanyContext), never
 * accepted from a client payload.
 */
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

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

const colorSchema = z
  .string()
  .trim()
  .regex(HEX_COLOR_PATTERN, "Color must be a valid hex value, e.g. #16a34a.")
  .nullable()
  .optional();

export const createDepartmentSchema = z
  .object({
    name: nameSchema,
    code: codeSchema,
    description: descriptionSchema,
    color: colorSchema,
    parentDepartmentId: z.string().uuid().nullable().optional(),
  })
  .strict();
export type CreateDepartmentValues = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z
  .object({
    departmentId: z.string().uuid(),
    name: nameSchema.optional(),
    code: codeSchema.optional(),
    description: descriptionSchema,
    color: colorSchema,
  })
  .strict();
export type UpdateDepartmentValues = z.infer<typeof updateDepartmentSchema>;

export const moveDepartmentSchema = z
  .object({
    departmentId: z.string().uuid(),
    newParentDepartmentId: z.string().uuid().nullable(),
  })
  .strict();

export const departmentStatusChangeSchema = z
  .object({
    departmentId: z.string().uuid(),
  })
  .strict();

export const listDepartmentsQuerySchema = z
  .object({
    search: searchQuerySchema,
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
    page: pageSchema,
    pageSize: pageSizeSchema,
  })
  .strict();
export type ListDepartmentsQuery = z.infer<typeof listDepartmentsQuerySchema>;
