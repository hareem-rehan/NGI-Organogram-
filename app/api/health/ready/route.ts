import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";

/**
 * Readiness probe — the check `lib/health.ts` said to add "alongside the
 * Prisma client when that lands".
 *
 * `/api/health` answers "is the process up and configured?" and
 * deliberately touches nothing. This answers "can it actually serve a
 * request?", which takes two things, not one:
 *
 *   1. the database is reachable, and
 *   2. the schema has been migrated into it.
 *
 * Both are worth separating. On a deployment where the app connects
 * through a pooled URL while migrations use a direct one, a wrong pooled
 * URL fails (1) while a migration that was never run fails (2) — and
 * (2) is invisible to every other check, because connecting to an empty
 * database succeeds perfectly well. Without this, the first symptom of an
 * unmigrated database is every page failing at once, for a deployment
 * whose build and liveness check were both green.
 *
 * Deliberately NOT authenticated: it has to be reachable before anyone
 * can log in, which is the point. It reveals only what an outage would
 * reveal anyway — reachable or not, migrated or not. No connection
 * string, no driver error, no table contents. The raw error goes to the
 * server log only.
 */
export async function GET() {
  let databaseReachable = false;
  try {
    // The cheapest possible round trip: proves the connection, the
    // credentials and the pooler, without reading a row of company data.
    await prisma.$queryRaw`SELECT 1`;
    databaseReachable = true;

    // Prisma's own bookkeeping table. Absent entirely on a database that
    // was created but never migrated; present with zero finished rows if
    // a migration started and failed. Counting only finished rows
    // distinguishes both from a healthy schema, and reads no application
    // data — this table holds migration names, nothing about the company.
    const rows = await prisma.$queryRaw<
      { count: bigint }[]
    >`SELECT COUNT(*) AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
    const applied = Number(rows[0]?.count ?? 0);

    if (applied === 0) {
      logger.error("readiness check failed", { reason: "no migrations applied" });
      return NextResponse.json(
        { status: "error", database: "reachable", schema: "missing" },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { status: "ok", database: "reachable", schema: "ready", migrationsApplied: applied },
      { status: 200 }
    );
  } catch (error) {
    logger.error("readiness check failed", {
      reason: error instanceof Error ? error.name : "unknown",
      stage: databaseReachable ? "schema" : "connection",
    });
    // 503, not 500: "not ready yet" is what a load balancer or a deploy
    // smoke check needs to tell apart from "broken".
    return NextResponse.json(
      databaseReachable
        ? { status: "error", database: "reachable", schema: "missing" }
        : { status: "error", database: "unreachable" },
      { status: 503 }
    );
  }
}
