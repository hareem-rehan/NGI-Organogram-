import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";

import type { DbClient } from "@/lib/repositories/types";

/**
 * Runs `fn` transactionally, composing correctly whether `db` is the base
 * `PrismaClient` (starts a NEW transaction) or an already-open
 * `Prisma.TransactionClient` (runs `fn` directly against it — Prisma's
 * transaction clients have no `$transaction` method of their own, so
 * nesting is not just unsupported, it's a silent correctness bug: calling
 * a service function's own internal `prisma.$transaction(...)` from
 * inside a caller's outer transaction would open a SEPARATE, unrelated
 * transaction on a different connection, breaking the caller's
 * atomicity guarantee without any error).
 *
 * Every `*.service.ts` create/move/update/archive/etc. function accepts
 * an optional trailing `db: DbClient = prisma` and calls this instead of
 * `prisma.$transaction` directly, specifically so Phase 10's CSV import
 * commit can compose many such calls into one real all-or-nothing
 * transaction (docs/adr/0007-import-strategy.md, CLAUDE.md §2 "Moving a
 * position is atomic"). Every existing caller that omits the parameter
 * behaves exactly as before — this is purely additive.
 */
export async function withTransaction<T>(
  db: DbClient,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { maxWait?: number; timeout?: number }
): Promise<T> {
  if (isBasePrismaClient(db)) return db.$transaction(fn, options);
  return fn(db);
}

function isBasePrismaClient(db: DbClient): db is PrismaClient {
  return typeof (db as PrismaClient).$transaction === "function";
}
