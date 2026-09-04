import { beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "@/lib/db/test-guard";

// Runs once when this setup file is loaded — before ANY integration test
// executes — and fails the entire run immediately if DATABASE_URL doesn't
// look like a disposable test database. This is the one guard standing
// between "npm run test:integration" and accidentally truncating
// something real; it must run before the client below ever connects.
assertSafeTestDatabaseUrl(process.env.DATABASE_URL);

export const testPrisma = new PrismaClient();

/**
 * Full truncate before EVERY test, not just once per file — integration
 * tests intentionally create data with real uniqueness constraints
 * (company codes, position codes), so starting each test from a
 * genuinely empty database is simpler and safer than trying to make
 * every test's fixtures unique from every other test's.
 */
beforeEach(async () => {
  await testPrisma.$executeRawUnsafe(
    `TRUNCATE TABLE "position_assignments", "positions", "employees", "job_grades", "departments", "companies" RESTART IDENTITY CASCADE;`
  );
});
