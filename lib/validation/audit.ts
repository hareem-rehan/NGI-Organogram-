import { z } from "zod";

import { pageSchema, pageSizeSchema } from "@/lib/validation/pagination";

/**
 * Server-side validation for audit query actions. `companyId`/`role` are
 * deliberately NOT fields here — always derived from the authenticated
 * session (lib/services/audit.service.ts's `queryAuditEvents` applies
 * role-based category restriction itself).
 */
export const auditCategorySchema = z.enum([
  "AUTHENTICATION",
  "USER_ADMINISTRATION",
  "COMPANY_SETTINGS",
  "DEPARTMENT",
  "POSITION",
  "HIERARCHY",
  "EMPLOYEE",
  "ASSIGNMENT",
  "IMPORT",
  "EXPORT",
  "SECURITY",
  "SYSTEM",
]);

export const auditActionSchema = z.enum([
  "CREATED",
  "UPDATED",
  "ARCHIVED",
  "REACTIVATED",
  "ASSIGNED",
  "TRANSFERRED",
  "ASSIGNMENT_ENDED",
  "TERMINATED",
  "ROLE_CHANGED",
  "USER_DISABLED",
  "USER_REACTIVATED",
  "USER_PROVISIONED",
  "USER_LINKED_TO_EMPLOYEE",
  "USER_UNLINKED_FROM_EMPLOYEE",
  "SETTINGS_CHANGED",
  "IMPORT_VALIDATED",
  "IMPORT_EXECUTED",
  "IMPORT_FAILED",
  "EXPORT_REQUESTED",
  "EXPORT_COMPLETED",
  "EXPORT_FAILED",
  "LOGIN_SUCCEEDED",
  "LOGIN_REJECTED",
  "UNAUTHORIZED_ACCESS_ATTEMPT",
]);

export const queryAuditEventsSchema = z
  .object({
    category: auditCategorySchema.optional(),
    action: auditActionSchema.optional(),
    actorUserId: z.string().uuid().optional(),
    actorEmailContains: z.string().trim().max(320).optional(),
    entityType: z.string().trim().max(100).optional(),
    entityId: z.string().trim().max(200).optional(),
    correlationId: z.string().trim().max(200).optional(),
    importJobId: z.string().uuid().optional(),
    exportJobId: z.string().uuid().optional(),
    occurredFrom: z.coerce.date().optional(),
    occurredTo: z.coerce.date().optional(),
    page: pageSchema.optional(),
    pageSize: pageSizeSchema.optional(),
  })
  .strict();

export const auditEventIdSchema = z
  .object({
    eventId: z.string().uuid(),
  })
  .strict();
