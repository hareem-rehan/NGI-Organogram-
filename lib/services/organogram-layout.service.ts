import "server-only";

import { prisma } from "@/lib/db/prisma";
import { withTransaction } from "@/lib/db/transaction";
import { CrossCompanyError, DomainValidationError } from "@/lib/domain/errors";
import { parseCardNodeKey, type CardOffset } from "@/lib/domain/organogram-card-offsets";
import type { DbClient } from "@/lib/repositories/types";
import { recordAuditEvent, type AuditActor } from "@/lib/services/audit.service";

/**
 * HR-placed organogram cards (docs/DECISIONS.md D38): an offset from each
 * dragged card's automatic layout position, shared by every viewer and by
 * exports. Purely visual — nothing here reads or writes a reporting line or
 * an organizational level.
 */

/** Every saved offset for the company, keyed by chart node id. */
export async function listCardOffsets(
  companyId: string,
  db: DbClient = prisma
): Promise<Record<string, CardOffset>> {
  const rows = await db.organogramCardOffset.findMany({
    where: { companyId },
    select: { nodeKey: true, dx: true, dy: true },
  });
  return Object.fromEntries(rows.map((r) => [r.nodeKey, { dx: r.dx, dy: r.dy }]));
}

/** The node key must name a card that really exists in this company. */
async function assertNodeKeyInCompany(nodeKey: string, companyId: string, db: DbClient) {
  const parsed = parseCardNodeKey(nodeKey);
  if (!parsed) throw new DomainValidationError("Unknown chart card.");
  const exists =
    parsed.kind === "position"
      ? await db.position.count({ where: { id: parsed.positionId, companyId } })
      : parsed.kind === "department"
        ? await db.department.count({ where: { id: parsed.departmentId, companyId } })
        : (await db.position.count({ where: { id: parsed.leadPositionId, companyId } })) *
          (await db.jobFamily.count({ where: { id: parsed.jobFamilyId, companyId } }));
  if (!exists) {
    throw new CrossCompanyError(`Chart card ${nodeKey} does not exist in company ${companyId}.`);
  }
}

/**
 * Saves where HR dropped a card. A zero offset (dragged back exactly onto its
 * automatic spot) removes the row instead of storing a no-op.
 */
export async function saveCardOffset(
  input: { companyId: string; nodeKey: string; dx: number; dy: number },
  db: DbClient = prisma
): Promise<void> {
  await assertNodeKeyInCompany(input.nodeKey, input.companyId, db);
  const dx = Math.round(input.dx);
  const dy = Math.round(input.dy);
  const where = { companyId_nodeKey: { companyId: input.companyId, nodeKey: input.nodeKey } };
  if (dx === 0 && dy === 0) {
    await db.organogramCardOffset.deleteMany({
      where: { companyId: input.companyId, nodeKey: input.nodeKey },
    });
    return;
  }
  await db.organogramCardOffset.upsert({
    where,
    create: { companyId: input.companyId, nodeKey: input.nodeKey, dx, dy },
    update: { dx, dy },
  });
}

/** Clears the given cards' offsets (a card re-attached elsewhere lands in its new place). */
export async function clearCardOffsets(
  input: { companyId: string; nodeKeys: readonly string[] },
  db: DbClient = prisma
): Promise<number> {
  const result = await db.organogramCardOffset.deleteMany({
    where: { companyId: input.companyId, nodeKey: { in: [...input.nodeKeys] } },
  });
  return result.count;
}

/**
 * "Reset positions": every card back to the automatic layout. Audited (a
 * single drag is not — moves are frequent and purely visual, D38).
 */
export async function resetCardOffsets(
  input: { companyId: string; actor?: AuditActor },
  db: DbClient = prisma
): Promise<number> {
  return withTransaction(db, async (tx) => {
    const { count } = await tx.organogramCardOffset.deleteMany({
      where: { companyId: input.companyId },
    });
    if (count > 0) {
      await recordAuditEvent(
        {
          companyId: input.companyId,
          actor: input.actor ?? "SYSTEM",
          action: "UPDATED",
          category: "COMPANY_SETTINGS",
          entityType: "OrganogramLayout",
          entityId: input.companyId,
          entityDisplayReference: "Organogram card positions reset",
          metadata: { clearedCardPositions: count },
        },
        tx
      );
    }
    return count;
  });
}
