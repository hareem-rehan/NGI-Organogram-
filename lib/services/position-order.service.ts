import "server-only";

import { prisma } from "@/lib/db/prisma";
import { withTransaction } from "@/lib/db/transaction";
import { NotFoundError } from "@/lib/domain/errors";
import type { DbClient } from "@/lib/repositories/types";
import { recordAuditEvent, type AuditActor } from "@/lib/services/audit.service";

/**
 * Saves the left-to-right order of sibling position cards on the organogram
 * (docs/DECISIONS.md D61) — the cards under one head, as dragged in Arrange
 * mode. Purely a display order (`Position.displayOrder`): it never touches a
 * reporting line or an organizational level (CLAUDE.md §2). Only rows whose
 * place changed are written and audit-logged.
 */
export async function reorderPositions(
  input: { companyId: string; actor?: AuditActor; orderedPositionIds: readonly string[] },
  db: DbClient = prisma
): Promise<void> {
  await withTransaction(db, async (tx) => {
    const existing = await tx.position.findMany({
      where: { companyId: input.companyId, id: { in: [...input.orderedPositionIds] } },
      select: { id: true, title: true, positionCode: true, displayOrder: true },
    });
    if (existing.length !== input.orderedPositionIds.length) {
      throw new NotFoundError("Position", "one or more of the reordered positions");
    }
    const byId = new Map(existing.map((p) => [p.id, p]));
    for (const [index, positionId] of input.orderedPositionIds.entries()) {
      const before = byId.get(positionId)!;
      const displayOrder = index + 1;
      if (before.displayOrder === displayOrder) continue;
      await tx.position.update({ where: { id: positionId }, data: { displayOrder } });
      await recordAuditEvent(
        {
          companyId: input.companyId,
          actor: input.actor ?? "SYSTEM",
          action: "UPDATED",
          category: "POSITION",
          entityType: "Position",
          entityId: positionId,
          entityDisplayReference: before.positionCode,
          before: { displayOrder: before.displayOrder },
          after: { displayOrder },
          metadata: { reordered: true },
        },
        tx
      );
    }
  });
}
