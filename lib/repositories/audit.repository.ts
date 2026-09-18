import "server-only";
import type {
  AuditAction,
  AuditActorType,
  AuditCategory,
  AuditEvent,
  Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import type { DbClient } from "@/lib/repositories/types";

/**
 * Deliberately exports ONLY create/read functions — no `updateAuditEvent`
 * or `deleteAuditEvent` exists anywhere in this file, so no service can
 * call one that doesn't exist (ADR-0015's application-layer immutability
 * guarantee; the database-layer guarantee is the `audit_events_no_update`/
 * `audit_events_no_delete` triggers added by hand to the migration).
 */

export interface CreateAuditEventInput {
  companyId: string;
  actorUserId: string | null;
  actorType: AuditActorType;
  actorDisplayNameSnapshot: string | null;
  actorEmailSnapshot: string | null;
  action: AuditAction;
  category: AuditCategory;
  entityType: string;
  entityId: string | null;
  entityDisplayReference: string | null;
  beforeData: Prisma.InputJsonValue | null;
  afterData: Prisma.InputJsonValue | null;
  changedFields: Prisma.InputJsonValue | null;
  correlationId: string | null;
  importJobId: string | null;
  exportJobId: string | null;
  safeMetadata: Prisma.InputJsonValue | null;
}

export async function createAuditEvent(
  input: CreateAuditEventInput,
  db: DbClient = prisma
): Promise<AuditEvent> {
  return db.auditEvent.create({
    data: {
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      actorType: input.actorType,
      actorDisplayNameSnapshot: input.actorDisplayNameSnapshot,
      actorEmailSnapshot: input.actorEmailSnapshot,
      action: input.action,
      category: input.category,
      entityType: input.entityType,
      entityId: input.entityId,
      entityDisplayReference: input.entityDisplayReference,
      beforeData: input.beforeData ?? undefined,
      afterData: input.afterData ?? undefined,
      changedFields: input.changedFields ?? undefined,
      correlationId: input.correlationId,
      importJobId: input.importJobId,
      exportJobId: input.exportJobId,
      safeMetadata: input.safeMetadata ?? undefined,
    },
  });
}

/** Batched insert for import-execution per-row events — one query, not N (Step 7's "efficient batches"). */
export async function createAuditEventsBatch(
  inputs: readonly CreateAuditEventInput[],
  db: DbClient = prisma
): Promise<void> {
  if (inputs.length === 0) return;
  await db.auditEvent.createMany({
    data: inputs.map((input) => ({
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      actorType: input.actorType,
      actorDisplayNameSnapshot: input.actorDisplayNameSnapshot,
      actorEmailSnapshot: input.actorEmailSnapshot,
      action: input.action,
      category: input.category,
      entityType: input.entityType,
      entityId: input.entityId,
      entityDisplayReference: input.entityDisplayReference,
      beforeData: input.beforeData ?? undefined,
      afterData: input.afterData ?? undefined,
      changedFields: input.changedFields ?? undefined,
      correlationId: input.correlationId,
      importJobId: input.importJobId,
      exportJobId: input.exportJobId,
      safeMetadata: input.safeMetadata ?? undefined,
    })),
  });
}

export async function findAuditEventById(
  id: string,
  companyId: string,
  db: DbClient = prisma
): Promise<AuditEvent | null> {
  return db.auditEvent.findFirst({ where: { id, companyId } });
}

export interface AuditEventFilters {
  companyId: string;
  categories?: readonly AuditCategory[];
  action?: AuditAction;
  actorUserId?: string;
  /** Substring match against the denormalized `actorEmailSnapshot` — lets the UI offer an actor search without a separate user-picker component, and still works for an actor whose User row no longer exists. */
  actorEmailContains?: string;
  entityType?: string;
  entityId?: string;
  correlationId?: string;
  importJobId?: string;
  exportJobId?: string;
  occurredFrom?: Date;
  occurredTo?: Date;
  skip: number;
  take: number;
}

export async function queryAuditEvents(
  filters: AuditEventFilters,
  db: DbClient = prisma
): Promise<{ events: AuditEvent[]; total: number }> {
  const where: Prisma.AuditEventWhereInput = {
    companyId: filters.companyId,
    ...(filters.categories ? { category: { in: [...filters.categories] } } : {}),
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.actorUserId ? { actorUserId: filters.actorUserId } : {}),
    ...(filters.actorEmailContains
      ? { actorEmailSnapshot: { contains: filters.actorEmailContains, mode: "insensitive" } }
      : {}),
    ...(filters.entityType ? { entityType: filters.entityType } : {}),
    ...(filters.entityId ? { entityId: filters.entityId } : {}),
    ...(filters.correlationId ? { correlationId: filters.correlationId } : {}),
    ...(filters.importJobId ? { importJobId: filters.importJobId } : {}),
    ...(filters.exportJobId ? { exportJobId: filters.exportJobId } : {}),
    ...(filters.occurredFrom || filters.occurredTo
      ? {
          occurredAt: {
            ...(filters.occurredFrom ? { gte: filters.occurredFrom } : {}),
            ...(filters.occurredTo ? { lte: filters.occurredTo } : {}),
          },
        }
      : {}),
  };

  const [events, total] = await Promise.all([
    db.auditEvent.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      skip: filters.skip,
      take: filters.take,
    }),
    db.auditEvent.count({ where }),
  ]);

  return { events, total };
}
