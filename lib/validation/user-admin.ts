import { z } from "zod";

import { pageSchema, pageSizeSchema, searchQuerySchema } from "@/lib/validation/pagination";

/**
 * Server-side validation for user-administration actions
 * (docs/adr/0014-web-based-user-administration.md). `companyId`/actor
 * are deliberately NOT fields here — always derived from the
 * authenticated session.
 */
export const userRoleSchema = z.enum(["ADMIN", "HR_EDITOR", "VIEWER"]);
export const userStatusSchema = z.enum(["ACTIVE", "DISABLED"]);

export const listUsersQuerySchema = z
  .object({
    search: searchQuerySchema,
    role: userRoleSchema.optional(),
    status: userStatusSchema.optional(),
    linked: z.enum(["linked", "unlinked"]).optional(),
    page: pageSchema.optional(),
    pageSize: pageSizeSchema.optional(),
  })
  .strict();

export const provisionUserSchema = z
  .object({
    email: z.string().trim().email("A valid email address is required.").max(320),
    displayName: z.string().trim().max(150).nullable().optional(),
    role: userRoleSchema,
    linkedEmployeeId: z.string().uuid().nullable().optional(),
  })
  .strict();

export const userIdSchema = z
  .object({
    userId: z.string().uuid(),
  })
  .strict();

export const changeUserRoleSchema = z
  .object({
    userId: z.string().uuid(),
    newRole: userRoleSchema,
    expectedUpdatedAt: z.coerce.date().optional(),
  })
  .strict();

export const disableUserSchema = z
  .object({
    userId: z.string().uuid(),
    expectedUpdatedAt: z.coerce.date().optional(),
  })
  .strict();

export const linkEmployeeSchema = z
  .object({
    userId: z.string().uuid(),
    employeeId: z.string().uuid(),
  })
  .strict();
