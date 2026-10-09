import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { EXPECTED_MIGRATIONS, findPendingMigrations } from "@/lib/db/expected-migrations";
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
 *   2. the schema has been migrated into it — ALL of the migrations this
 *      version of the code needs (lib/db/expected-migrations.ts), not just
 *      some. A database one migration behind the code (the 2026-09-28
 *      staging incident) is reported as "pending", not "ready".
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
      { migration_name: string }[]
    >`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    const appliedNames = rows.map((row) => row.migration_name);
    const applied = appliedNames.length;

    if (applied === 0) {
      logger.error("readiness check failed", { reason: "no migrations applied" });
      return NextResponse.json(
        { status: "error", database: "reachable", schema: "missing" },
        { status: 503 }
      );
    }

    // The code is ahead of the database: some migration this version needs
    // has not been applied. Pages touching the new schema would fail, so
    // this is not ready. The response gives counts only; the missing
    // migration names go to the server log for whoever runs the deploy.
    const pending = findPendingMigrations(EXPECTED_MIGRATIONS, appliedNames);
    if (pending.length > 0) {
      logger.error("readiness check failed", {
        reason: "migrations pending",
        pendingMigrations: pending.join(","),
      });
      return NextResponse.json(
        {
          status: "error",
          database: "reachable",
          schema: "pending",
          migrationsApplied: applied,
          migrationsPending: pending.length,
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        status: "ok",
        database: "reachable",
        schema: "ready",
        migrationsApplied: applied,
        migrationsExpected: EXPECTED_MIGRATIONS.length,
      },
      { status: 200 }
    );
  } catch (error) {
    // The driver's error CODE (e.g. P1000 wrong credentials, P1001 can't
    // reach the server, P1013 invalid connection string) goes to the
    // server log so an outage can be diagnosed from the deployment logs —
    // never the message text, which can echo the connection string.
    const rawCode =
      error && typeof error === "object" && "errorCode" in error
        ? String((error as { errorCode?: unknown }).errorCode ?? "")
        : error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code ?? "")
          : "";
    // Only something shaped like a code is logged, so nothing else an error
    // object carries can ever reach the logs.
    const code = /^[A-Za-z0-9_]{1,32}$/.test(rawCode) ? rawCode : rawCode ? "other" : "none";
    logger.error("readiness check failed", {
      reason: error instanceof Error ? error.name : "unknown",
      code,
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
