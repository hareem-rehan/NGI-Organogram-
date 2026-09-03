/**
 * Mocked-auth helper for E2E tests. Creates a real Company + User +
 * Account + Session row directly via Prisma (bypassing any live OIDC
 * provider — there isn't one confirmed yet, see docs/DECISIONS.md P8)
 * so Playwright can drive the app as an authenticated user without a
 * real identity provider to talk to.
 *
 * This intentionally reuses the same production session-cookie shape
 * Auth.js's database session strategy creates (see lib/auth/config.ts),
 * so it exercises the real session-lookup path (`auth()` ->
 * PrismaAdapter -> Session table), not a stubbed one.
 *
 * Guarded by the same assertSafeTestDatabaseUrl() used by the
 * integration test suite — refuses to run against anything that
 * doesn't clearly look like a disposable test database.
 */
import { randomBytes } from "node:crypto";
import { PrismaClient, type UserRole } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/db/test-guard";

const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface SeededSession {
  cookieValue: string;
  userEmail: string;
}

export async function seedAuthenticatedSession(role: UserRole): Promise<SeededSession> {
  assertSafeTestDatabaseUrl(process.env.DATABASE_URL);

  const prisma = new PrismaClient();
  try {
    const companyCode = `E2E-${randomBytes(4).toString("hex")}`;
    const company = await prisma.company.create({
      data: { name: `E2E Test Company ${companyCode}`, code: companyCode },
    });

    const userEmail = `e2e-${role.toLowerCase()}-${randomBytes(4).toString("hex")}@e2e-test.invalid`;
    const user = await prisma.user.create({
      data: {
        email: userEmail,
        name: `E2E ${role}`,
        companyId: company.id,
        role,
        status: "ACTIVE",
      },
    });

    await prisma.account.create({
      data: {
        userId: user.id,
        type: "oidc",
        provider: "company-sso",
        providerAccountId: `e2e-sub-${randomBytes(8).toString("hex")}`,
      },
    });

    const sessionToken = randomBytes(32).toString("hex");
    await prisma.session.create({
      data: {
        sessionToken,
        userId: user.id,
        expires: new Date(Date.now() + SESSION_MAX_AGE_MS),
      },
    });

    return { cookieValue: sessionToken, userEmail };
  } finally {
    await prisma.$disconnect();
  }
}
