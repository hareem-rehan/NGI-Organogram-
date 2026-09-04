"use server";

import type { AuditEvent } from "@prisma/client";

import { requirePermission } from "@/lib/auth/current-user";
import { runAction, type ActionResult } from "@/lib/server/action-result";
import {
  getAuditEvent,
  queryAuditEvents,
  type AuditQueryResult,
} from "@/lib/services/audit.service";
import { auditEventIdSchema, queryAuditEventsSchema } from "@/lib/validation/audit";

export async function listAuditEventsAction(
  input: unknown
): Promise<ActionResult<AuditQueryResult>> {
  return runAction(async () => {
    const user = await requirePermission("audit:view");
    const query = queryAuditEventsSchema.parse(input);
    return queryAuditEvents({ companyId: user.companyId, role: user.role, ...query });
  });
}

export async function getAuditEventAction(input: unknown): Promise<ActionResult<AuditEvent>> {
  return runAction(async () => {
    const user = await requirePermission("audit:view");
    const { eventId } = auditEventIdSchema.parse(input);
    return getAuditEvent(eventId, user.companyId, user.role);
  });
}
