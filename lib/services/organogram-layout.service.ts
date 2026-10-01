import "server-only";

import { prisma } from "@/lib/db/prisma";
import { withTransaction } from "@/lib/db/transaction";
import { CrossCompanyError, DomainValidationError } from "@/lib/domain/errors";
import { parseCardNodeKey, type CardOffset } from "@/lib/domain/organogram-card-offsets";
import {
  CHART_STYLE_KEY,
  compactTextStyle,
  isEmptyTextStyle,
  type TextStyle,
} from "@/lib/domain/organogram-text-style";
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

// ── Text styles (docs/DECISIONS.md D41) ─────────────────────────────────

export interface OrganogramTextStyles {
  /** The style for every card ({} when nothing is set). */
  chart: TextStyle;
  /** Per-card overrides, keyed by chart node id. */
  cards: Record<string, TextStyle>;
}

export async function listTextStyles(
  companyId: string,
  db: DbClient = prisma
): Promise<OrganogramTextStyles> {
  const rows = await db.organogramTextStyle.findMany({ where: { companyId } });
  const styles: OrganogramTextStyles = { chart: {}, cards: {} };
  for (const row of rows) {
    const style = compactTextStyle(row);
    if (row.nodeKey === CHART_STYLE_KEY) styles.chart = style;
    else styles.cards[row.nodeKey] = style;
  }
  return styles;
}

/**
 * Saves the chart-wide style or one card's. An all-unset style removes the
 * row (back to inheriting). Audited — style changes are deliberate and rare.
 */
export async function saveTextStyle(
  input: { companyId: string; actor?: AuditActor; nodeKey: string; style: TextStyle },
  db: DbClient = prisma
): Promise<void> {
  if (input.nodeKey !== CHART_STYLE_KEY) {
    await assertNodeKeyInCompany(input.nodeKey, input.companyId, db);
  }
  const style = compactTextStyle(input.style);
  const data = {
    fontFamily: style.fontFamily ?? null,
    fontSize: style.fontSize ?? null,
    color: style.color?.toLowerCase() ?? null,
    bold: style.bold ?? null,
    italic: style.italic ?? null,
    underline: style.underline ?? null,
    strikethrough: style.strikethrough ?? null,
  };
  await withTransaction(db, async (tx) => {
    if (isEmptyTextStyle(style)) {
      await tx.organogramTextStyle.deleteMany({
        where: { companyId: input.companyId, nodeKey: input.nodeKey },
      });
    } else {
      await tx.organogramTextStyle.upsert({
        where: { companyId_nodeKey: { companyId: input.companyId, nodeKey: input.nodeKey } },
        create: { companyId: input.companyId, nodeKey: input.nodeKey, ...data },
        update: data,
      });
    }
    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor ?? "SYSTEM",
        action: "UPDATED",
        category: "COMPANY_SETTINGS",
        entityType: "OrganogramTextStyle",
        entityId: input.companyId,
        entityDisplayReference:
          input.nodeKey === CHART_STYLE_KEY
            ? "Organogram text style (all cards)"
            : `Card ${input.nodeKey}`,
        after: style,
      },
      tx
    );
  });
}
