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

/**
 * Placements saved before moving came back as "move the card with its whole
 * branch" (D62) are ignored: they were single cards left away from their
 * branch (D38), switched off at 14:40 UTC on 19 Oct 2026 (D61). Anything
 * saved after this moment was saved by D62.
 */
export const BRANCH_MOVES_SINCE = new Date("2026-10-19T14:45:00Z");

/**
 * Every saved card/box offset for the company (D62), keyed by chart node id —
 * where HR moved a card and its branch to. Shared by the screen and exports.
 */
export async function listCardOffsets(
  companyId: string,
  db: DbClient = prisma
): Promise<Record<string, CardOffset>> {
  const rows = await db.organogramCardOffset.findMany({
    where: { companyId, updatedAt: { gt: BRANCH_MOVES_SINCE } },
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

/** Most cards one move may save — a whole branch, bounded. */
export const MAX_CARD_MOVES = 1000;

/**
 * Saves where cards were moved (D62): a card dragged to a free spot and every
 * card below it, by the same amount, in one transaction. A zero offset
 * (moved back exactly onto its automatic spot) removes the row. Purely
 * visual — never a reporting line or a level.
 */
export async function saveCardOffsets(
  input: {
    companyId: string;
    moves: readonly { nodeKey: string; dx: number; dy: number }[];
  },
  db: DbClient = prisma
): Promise<void> {
  if (input.moves.length > MAX_CARD_MOVES) {
    throw new DomainValidationError(`At most ${MAX_CARD_MOVES} cards can be moved at once.`);
  }
  // Every card must belong to this company: checked in three queries, not
  // one per card (a branch can be large; staging is far from the database).
  const positionIds = new Set<string>();
  const departmentIds = new Set<string>();
  const familyIds = new Set<string>();
  for (const move of input.moves) {
    const parsed = parseCardNodeKey(move.nodeKey);
    if (!parsed) throw new DomainValidationError("Unknown chart card.");
    if (parsed.kind === "position") positionIds.add(parsed.positionId);
    else if (parsed.kind === "department") departmentIds.add(parsed.departmentId);
    else {
      positionIds.add(parsed.leadPositionId);
      familyIds.add(parsed.jobFamilyId);
    }
  }
  const [positions, departments, families] = await Promise.all([
    db.position.count({ where: { companyId: input.companyId, id: { in: [...positionIds] } } }),
    db.department.count({ where: { companyId: input.companyId, id: { in: [...departmentIds] } } }),
    db.jobFamily.count({ where: { companyId: input.companyId, id: { in: [...familyIds] } } }),
  ]);
  if (
    positions !== positionIds.size ||
    departments !== departmentIds.size ||
    families !== familyIds.size
  ) {
    throw new CrossCompanyError("One or more chart cards do not exist in this company.");
  }

  const rounded = input.moves.map((m) => ({
    nodeKey: m.nodeKey,
    dx: Math.round(m.dx),
    dy: Math.round(m.dy),
  }));
  await withTransaction(db, async (tx) => {
    // Replace the moved cards' rows; a zero offset just leaves none.
    await tx.organogramCardOffset.deleteMany({
      where: { companyId: input.companyId, nodeKey: { in: rounded.map((m) => m.nodeKey) } },
    });
    const kept = rounded.filter((m) => m.dx !== 0 || m.dy !== 0);
    if (kept.length > 0) {
      await tx.organogramCardOffset.createMany({
        data: kept.map((m) => ({ companyId: input.companyId, ...m })),
      });
    }
  });
}

/** One card's offset — the same as moving just that card. */
export async function saveCardOffset(
  input: { companyId: string; nodeKey: string; dx: number; dy: number },
  db: DbClient = prisma
): Promise<void> {
  await saveCardOffsets(
    { companyId: input.companyId, moves: [{ nodeKey: input.nodeKey, dx: input.dx, dy: input.dy }] },
    db
  );
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
