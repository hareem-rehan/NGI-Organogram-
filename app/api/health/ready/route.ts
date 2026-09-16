import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";

/**
 * Readiness probe — the check `lib/health.ts` said to add "alongside the
 * Prisma client when that lands".
 *
 * `/api/health` answers "is the process up and configured?" and
 * deliberately touches nothing. This answers the different question "can
 * it actually serve a request?", which for this app means one thing:
 * whether the database is reachable.
 *
 * That distinction matters on a deployment where the app boots from one
 * connection string and migrates through another. A wrong pooled URL
 * leaves `/api/health` perfectly green while every real page fails, and
 * without this the first symptom would be a user unable to sign in.
 *
 * Deliberately NOT authenticated. It is reachable before anyone can log
 * in, which is the point — and it reveals only what an outage would
 * reveal anyway: reachable, or not. No connection string, no driver
 * error, no timing detail. The raw error goes to the server log only.
 */
export async function GET() {
  try {
    // The cheapest possible round trip: proves the connection, the
    // credentials and the pooler all work, without reading a single row
    // of company data.
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      { status: "ok", database: "reachable", timestamp: new Date().toISOString() },
      { status: 200 }
    );
  } catch (error) {
    logger.error("readiness check failed", {
      reason: error instanceof Error ? error.name : "unknown",
    });
    // 503, not 500: this is "not ready yet", which is what a load
    // balancer or a deploy smoke check needs to distinguish.
    return NextResponse.json(
      { status: "error", database: "unreachable", timestamp: new Date().toISOString() },
      { status: 503 }
    );
  }
}
