import "server-only";
import crypto from "node:crypto";
import type { AuditAction, AuditCategory, AuditEvent, UserRole } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { DomainValidationError, NotFoundError } from "@/lib/domain/errors";
import { computeChangedFields, redactForAudit, sanitizeMetadata } from "@/lib/domain/audit/redact";
import {
  DEFAULT_AUDIT_PAGE_SIZE,
  MAX_AUDIT_DATE_RANGE_DAYS,
  MAX_AUDIT_PAGE_SIZE,
} from "@/lib/domain/audit/pagination";
import type { DbClient } from "@/lib/repositories/types";
import {
  createAuditEvent,
  createAuditEventsBatch,
  findAuditEventById,
  queryAuditEvents as queryAuditEventsRepo,
  type CreateAuditEventInput,
} from "@/lib/repositories/audit.repository";

/**
 * Categories an HR_EDITOR may see under `audit:view` — a conservative
 * default (docs/DECISIONS.md, CLAUDE.md §5) since no explicit HR
 * decision approved HR_EDITOR seeing user-administration/settings/
 * security events. ADMIN sees every category. A category NOT in this
 * set is invisible to HR_EDITOR — never filtered client-side, never
 * returned and hidden by the UI (ADR-0015).
 */
export const HR_EDITOR_VISIBLE_CATEGORIES: readonly AuditCategory[] = [
  "DEPARTMENT",
  "POSITION",
  "HIERARCHY",
  "EMPLOYEE",
  "ASSIGNMENT",
  "IMPORT",
  "EXPORT",
];

function categoriesVisibleToRole(role: UserRole): readonly AuditCategory[] | null {
  // null means "no restriction" (ADMIN).
  if (role === "ADMIN") return null;
  return HR_EDITOR_VISIBLE_CATEGORIES;
}

export type AuditActor =
  { userId: string; displayName: string | null; email: string | null } | "SYSTEM";

export interface RecordAuditEventInput {
  companyId: string;
  actor: AuditActor;
  action: AuditAction;
  category: AuditCategory;
  entityType: string;
  entityId?: string | null;
  entityDisplayReference?: string | null;
  /** Raw (unredacted) before/after snapshots — redaction happens inside this function, never by the caller. */
  before?: unknown;
  after?: unknown;
  correlationId?: string | null;
  importJobId?: string | null;
  exportJobId?: string | null;
  metadata?: Record<string, unknown> | null;
}

function buildCreateInput(input: RecordAuditEventInput): CreateAuditEventInput {
  const beforeData =
    input.before !== undefined ? redactForAudit(input.entityType, input.before) : null;
  const afterData =
    input.after !== undefined ? redactForAudit(input.entityType, input.after) : null;
  const changedFields =
    input.before !== undefined || input.after !== undefined
      ? computeChangedFields(beforeData, afterData)
      : null;

  return {
    companyId: input.companyId,
    actorUserId: input.actor === "SYSTEM" ? null : input.actor.userId,
    actorType: input.actor === "SYSTEM" ? "SYSTEM" : "USER",
    actorDisplayNameSnapshot:
      input.actor === "SYSTEM" ? "System" : (input.actor.displayName ?? null),
    actorEmailSnapshot: input.actor === "SYSTEM" ? null : (input.actor.email ?? null),
    action: input.action,
    category: input.category,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    entityDisplayReference: input.entityDisplayReference ?? null,
    beforeData: beforeData as CreateAuditEventInput["beforeData"],
    afterData: afterData as CreateAuditEventInput["afterData"],
    changedFields: changedFields as CreateAuditEventInput["changedFields"],
    correlationId: input.correlationId ?? crypto.randomUUID(),
    importJobId: input.importJobId ?? null,
    exportJobId: input.exportJobId ?? null,
    safeMetadata: (input.metadata !== undefined
      ? sanitizeMetadata(input.metadata)
      : null) as CreateAuditEventInput["safeMetadata"],
  };
}

/**
 * The ONE way any service writes an audit event (ADR-0008/ADR-0015).
 * Callers pass `db` as the SAME `Prisma.TransactionClient` their own
 * mutation is running inside (via `withTransaction`) — a required
 * critical-mutation audit write therefore fails/rolls back together
 * with the mutation it documents, by construction, not by a separate
 * try/catch. Never accepts pre-redacted data from a caller — redaction
 * always happens here, so there is exactly one place that can get it
 * wrong, and exactly one place tested for it (lib/domain/audit/redact.test.ts).
 */
export async function recordAuditEvent(
  input: RecordAuditEventInput,
  db: DbClient = prisma
): Promise<AuditEvent> {
  return createAuditEvent(buildCreateInput(input), db);
}

/** Batched writer for many events sharing one correlationId (e.g. an import execution's per-row events) — one query, not N. */
export async function recordAuditEventsBatch(
  inputs: readonly RecordAuditEventInput[],
  db: DbClient = prisma
): Promise<void> {
  await createAuditEventsBatch(inputs.map(buildCreateInput), db);
}

export interface AuditQueryInput {
  companyId: string;
  role: UserRole;
  category?: AuditCategory;
  action?: AuditAction;
  actorUserId?: string;
  actorEmailContains?: string;
  entityType?: string;
  entityId?: string;
  correlationId?: string;
  importJobId?: string;
  exportJobId?: string;
  occurredFrom?: Date;
  occurredTo?: Date;
  page?: number;
  pageSize?: number;
}

export { MAX_AUDIT_PAGE_SIZE, DEFAULT_AUDIT_PAGE_SIZE, MAX_AUDIT_DATE_RANGE_DAYS };

export interface AuditQueryResult {
  events: AuditEvent[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Company-scoped, role-visibility-filtered, paginated audit query — the
 * ONLY read path the UI uses (Step 8). `role` comes from the
 * authenticated session (never client input); an HR_EDITOR's
 * `category` filter is silently intersected with
 * `HR_EDITOR_VISIBLE_CATEGORIES` — requesting `USER_ADMINISTRATION`
 * explicitly returns zero rows, never an error revealing the category
 * exists, and never the actual restricted data.
 */
export async function queryAuditEvents(input: AuditQueryInput): Promise<AuditQueryResult> {
  const page = input.page && input.page > 0 ? Math.floor(input.page) : 1;
  const pageSize =
    input.pageSize && input.pageSize > 0
      ? Math.min(Math.floor(input.pageSize), MAX_AUDIT_PAGE_SIZE)
      : DEFAULT_AUDIT_PAGE_SIZE;

  if (
    input.occurredFrom &&
    input.occurredTo &&
    input.occurredFrom.getTime() > input.occurredTo.getTime()
  ) {
    throw new DomainValidationError("The date range's start must not be after its end.");
  }
  if (input.occurredFrom && input.occurredTo) {
    const rangeDays =
      (input.occurredTo.getTime() - input.occurredFrom.getTime()) / (24 * 60 * 60 * 1000);
    if (rangeDays > MAX_AUDIT_DATE_RANGE_DAYS) {
      throw new DomainValidationError(
        `The date range cannot exceed ${MAX_AUDIT_DATE_RANGE_DAYS} days. Narrow the range and try again.`
      );
    }
  }

  const roleCategories = categoriesVisibleToRole(input.role);
  let categories: readonly AuditCategory[] | undefined;
  if (roleCategories !== null) {
    // Restricted role: intersect the requested category (if any) with
    // what the role can see. A requested category outside the visible
    // set collapses to an impossible filter (zero results), never an
    // error that would confirm the category exists.
    categories = input.category
      ? roleCategories.filter((c) => c === input.category)
      : roleCategories;
  } else if (input.category) {
    categories = [input.category];
  }

  const { events, total } = await queryAuditEventsRepo({
    companyId: input.companyId,
    categories,
    action: input.action,
    actorUserId: input.actorUserId,
    actorEmailContains: input.actorEmailContains,
    entityType: input.entityType,
    entityId: input.entityId,
    correlationId: input.correlationId,
    importJobId: input.importJobId,
    exportJobId: input.exportJobId,
    occurredFrom: input.occurredFrom,
    occurredTo: input.occurredTo,
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  return { events, total, page, pageSize };
}

/** Single-event detail view — same role-category restriction as the list, applied by re-checking rather than trusting that a listed id implies visibility. */
export async function getAuditEvent(
  id: string,
  companyId: string,
  role: UserRole
): Promise<AuditEvent> {
  const event = await findAuditEventById(id, companyId, prisma);
  if (!event) throw new NotFoundError("AuditEvent", id);

  const roleCategories = categoriesVisibleToRole(role);
  if (roleCategories !== null && !roleCategories.includes(event.category)) {
    throw new NotFoundError("AuditEvent", id);
  }
  return event;
}
