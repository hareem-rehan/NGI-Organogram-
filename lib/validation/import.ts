import { z } from "zod";

/**
 * Server-side validation for CSV import actions. `companyId`/`userId` are
 * never fields here — always derived from the authenticated session
 * (docs/AUTHORIZATION_MATRIX.md), exactly like every other domain's
 * validation module.
 */
export const importTypeSchema = z.enum(["DEPARTMENT", "POSITION", "EMPLOYEE", "ASSIGNMENT"]);
export const importModeSchema = z.enum(["CREATE_ONLY", "UPSERT"]);

export const importJobIdSchema = z
  .object({
    jobId: z.string().uuid(),
  })
  .strict();

export const confirmImportSchema = z
  .object({
    jobId: z.string().uuid(),
    acknowledgeWarnings: z.boolean(),
  })
  .strict();

export const downloadTemplateSchema = z
  .object({
    importType: importTypeSchema,
  })
  .strict();
