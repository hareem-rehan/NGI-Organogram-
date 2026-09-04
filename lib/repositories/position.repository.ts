import "server-only";
import { Prisma } from "@prisma/client";
import type { Position } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import type { DbClient } from "@/lib/repositories/types";
import { HierarchyDepthExceededError, MAX_HIERARCHY_DEPTH } from "@/lib/domain/hierarchy";
import { dateRangesOverlap } from "@/lib/domain/assignment";

export interface PositionSearchParams {
  companyId: string;
  search?: string;
  departmentId?: string;
  status?: "PLANNED" | "ACTIVE" | "INACTIVE";
  /** Restricts to positions with (or without) a currently-effective primary assignment, as of `onDate` (defaults to now). Independent of `status` — occupancy and lifecycle status are separate concepts (docs/DASHBOARD_METRICS.md). */
  occupancy?: "occupied" | "vacant";
  onDate?: Date;
  page: number;
  pageSize: number;
}

export interface PositionSearchResult {
  items: Position[];
  totalCount: number;
}

/** Server-side paginated/filterable position listing for the Positions screen. `search` matches title or positionCode (case-insensitive, substring). */
export async function searchPositions(
  params: PositionSearchParams,
  db: DbClient = prisma
): Promise<PositionSearchResult> {
  const onDate = params.onDate ?? new Date();
  const currentAssignmentFilter = {
    isPrimary: true as const,
    startDate: { lte: onDate },
    OR: [{ endDate: null }, { endDate: { gt: onDate } }],
  };

  const where: Prisma.PositionWhereInput = {
    companyId: params.companyId,
    ...(params.departmentId ? { departmentId: params.departmentId } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.occupancy === "occupied" ? { assignments: { some: currentAssignmentFilter } } : {}),
    ...(params.occupancy === "vacant" ? { assignments: { none: currentAssignmentFilter } } : {}),
    ...(params.search
      ? {
          OR: [
            { title: { contains: params.search, mode: "insensitive" } },
            { positionCode: { contains: params.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [items, totalCount] = await Promise.all([
    db.position.findMany({
      where,
      orderBy: [{ organizationalLevel: "asc" }, { displayOrder: "asc" }, { title: "asc" }],
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    db.position.count({ where }),
  ]);

  return { items, totalCount };
}

/** Every position in the company, for use in pickers (Reports-To combobox, eligible-position search) — capped, not truly unbounded, per docs/DECISIONS.md P7's ~2,000-position scale target. */
export async function listAllPositionsForCompany(
  companyId: string,
  db: DbClient = prisma
): Promise<Position[]> {
  return db.position.findMany({
    where: { companyId },
    orderBy: [{ organizationalLevel: "asc" }, { title: "asc" }],
    take: 2000,
  });
}

/**
 * Bulk "is there a currently-effective primary occupant" lookup for a set
 * of positions — one query, not N. `onDate` is compared as a plain Date
 * (Postgres `date` columns), matching the same half-open effective-date
 * semantics as lib/domain/assignment.ts: startDate <= onDate and
 * (endDate IS NULL OR onDate < endDate). Returns the set of positionIds
 * that are currently occupied — callers treat everything else as vacant.
 */
export async function listOccupiedPositionIds(
  positionIds: readonly string[],
  companyId: string,
  onDate: Date,
  db: DbClient = prisma
): Promise<Set<string>> {
  if (positionIds.length === 0) return new Set();
  const rows = await db.positionAssignment.findMany({
    where: {
      companyId,
      positionId: { in: [...positionIds] },
      isPrimary: true,
      startDate: { lte: onDate },
      OR: [{ endDate: null }, { endDate: { gt: onDate } }],
    },
    select: { positionId: true },
  });
  return new Set(rows.map((row) => row.positionId));
}

export interface EligiblePosition {
  position: Position;
  departmentName: string;
}

/**
 * Positions a NEW assignment could target, effective `effectiveDate` —
 * same company, not INACTIVE (PLANNED is allowed — a future hire against
 * a not-yet-live position is legitimate HR planning), in an ACTIVE
 * department, and not already occupied by an overlapping primary
 * assignment as of that date. Used by the "Assign to Position" and
 * "Change destination" eligible-position pickers
 * (docs/phase-reports/PHASE_06_EMPLOYEES_AND_ASSIGNMENTS.md). One query
 * (assignments included, not N+1), filtered in application code with the
 * exact same overlap logic `createAssignment`/`transferEmployee` use, so
 * the picker can never suggest a position the actual assignment call
 * would then reject.
 */
export async function searchEligiblePositions(
  companyId: string,
  search: string | undefined,
  effectiveDate: Date,
  db: DbClient = prisma
): Promise<EligiblePosition[]> {
  const candidates = await db.position.findMany({
    where: {
      companyId,
      status: { not: "INACTIVE" },
      department: { status: "ACTIVE" },
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" } },
              { positionCode: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      department: { select: { name: true } },
      assignments: { where: { isPrimary: true } },
    },
    orderBy: [{ title: "asc" }],
    take: 100,
  });

  const newRange = { startDate: effectiveDate, endDate: null };
  return candidates
    .filter(
      (candidate) =>
        !candidate.assignments.some((existing) =>
          dateRangesOverlap({ startDate: existing.startDate, endDate: existing.endDate }, newRange)
        )
    )
    .map((candidate) => ({
      position: candidate,
      departmentName: candidate.department.name,
    }));
}

export async function findPositionById(
  id: string,
  companyId: string,
  db: DbClient = prisma
): Promise<Position | null> {
  return db.position.findFirst({ where: { id, companyId } });
}

/**
 * Row-locks the given positions (company-scoped, deduplicated, always in
 * ascending `id` order to avoid deadlocking against another call locking
 * the same set) via `SELECT ... FOR UPDATE`, without reading any other
 * column. Must be called FIRST, before any other read in the same
 * transaction that will inform a decision about these positions'
 * hierarchy — see hierarchy.service.ts's `movePosition` for why: without
 * this lock, two concurrent moves that are each individually valid (no
 * cycle exists in either's pre-move snapshot) can both pass cycle
 * detection and commit, jointly creating a real reporting cycle, because
 * Postgres's default Read Committed isolation lets each transaction's
 * plain `SELECT`-based ancestor-chain check read the other's pre-commit
 * state. Locking every row involved BEFORE that check forces the second
 * racing transaction to block until the first commits, so its own
 * ancestor-chain check then sees the first move's real, committed effect
 * (docs/DECISIONS.md, Phase 13 hardening; `.claude/skills/organogram-
 * hierarchy-safety/SKILL.md` invariant 12).
 *
 * Only Prisma's untyped-but-parameterized `$queryRaw` can express
 * `FOR UPDATE` — there is no query-builder equivalent — but every value
 * is passed through Prisma's own tagged-template parameterization
 * (`Prisma.sql`/`Prisma.join`), never string-concatenated, so this
 * carries the same SQL-injection safety as every other Prisma call in
 * this codebase.
 */
export async function lockPositionsForUpdate(
  ids: readonly string[],
  companyId: string,
  db: DbClient
): Promise<void> {
  const uniqueSortedIds = Array.from(new Set(ids)).sort();
  if (uniqueSortedIds.length === 0) return;

  // Each id must be cast to ::uuid individually — Prisma.join's
  // parameters are otherwise sent as `text`, and Postgres has no
  // implicit uuid = text comparison operator (confirmed by running this
  // query: `operator does not exist: uuid = text`).
  const idList = Prisma.join(uniqueSortedIds.map((id) => Prisma.sql`${id}::uuid`));

  await db.$queryRaw`
    SELECT id FROM positions
    WHERE id IN (${idList}) AND "companyId" = ${companyId}::uuid
    ORDER BY id
    FOR UPDATE
  `;
}

export async function getPositionChildren(
  positionId: string,
  companyId: string,
  db: DbClient = prisma
): Promise<Position[]> {
  return db.position.findMany({
    where: { primaryReportsToPositionId: positionId, companyId },
    orderBy: [{ displayOrder: "asc" }, { title: "asc" }],
  });
}

export async function countDirectReports(
  positionId: string,
  companyId: string,
  db: DbClient = prisma
): Promise<number> {
  return db.position.count({ where: { primaryReportsToPositionId: positionId, companyId } });
}

export async function findRootPosition(
  companyId: string,
  db: DbClient = prisma
): Promise<Position | null> {
  return db.position.findFirst({ where: { companyId, primaryReportsToPositionId: null } });
}

/**
 * Walks primaryReportsToPositionId from `startPositionId` up to the root,
 * returning nodes in "start, parent, grandparent, ..., root" order
 * (inclusive of the start position). Used both for cycle detection
 * (domain/hierarchy.wouldCreateCycle) and for assembling a breadcrumb
 * reporting path (domain/hierarchy.buildReportingPath).
 */
export async function getPositionAncestorChain(
  startPositionId: string,
  companyId: string,
  db: DbClient = prisma
): Promise<{ id: string; title: string; organizationalLevel: number }[]> {
  const chain: { id: string; title: string; organizationalLevel: number }[] = [];
  let currentId: string | null = startPositionId;

  while (currentId !== null) {
    if (chain.length > MAX_HIERARCHY_DEPTH) {
      throw new HierarchyDepthExceededError(MAX_HIERARCHY_DEPTH);
    }
    const current: {
      id: string;
      title: string;
      organizationalLevel: number;
      primaryReportsToPositionId: string | null;
    } | null = await db.position.findFirst({
      where: { id: currentId, companyId },
      select: {
        id: true,
        title: true,
        organizationalLevel: true,
        primaryReportsToPositionId: true,
      },
    });
    if (!current) break;
    chain.push({
      id: current.id,
      title: current.title,
      organizationalLevel: current.organizationalLevel,
    });
    currentId = current.primaryReportsToPositionId;
  }

  return chain;
}

/**
 * Breadth-first fetch of every descendant of `rootPositionId` (not
 * including the root itself), each annotated with its immediate parent
 * id. Used when moving a branch: every descendant's stored
 * organizationalLevel must be recalculated in the same transaction as
 * the move (docs/adr/0005-transaction-strategy.md).
 */
export async function getPositionSubtree(
  rootPositionId: string,
  companyId: string,
  db: DbClient = prisma
): Promise<{ id: string; parentId: string | null; organizationalLevel: number }[]> {
  const subtree: { id: string; parentId: string | null; organizationalLevel: number }[] = [];
  let frontier = [rootPositionId];
  let depth = 0;

  while (frontier.length > 0) {
    if (depth++ > MAX_HIERARCHY_DEPTH) {
      throw new HierarchyDepthExceededError(MAX_HIERARCHY_DEPTH);
    }
    const children = await db.position.findMany({
      where: { primaryReportsToPositionId: { in: frontier }, companyId },
      select: { id: true, primaryReportsToPositionId: true, organizationalLevel: true },
    });
    if (children.length === 0) break;
    for (const child of children) {
      subtree.push({
        id: child.id,
        parentId: child.primaryReportsToPositionId,
        organizationalLevel: child.organizationalLevel,
      });
    }
    frontier = children.map((c) => c.id);
  }

  return subtree;
}
