import "server-only";
import crypto from "node:crypto";
import type { UserRole } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

/**
 * A local-development-only convenience for signing in without a real
 * OIDC provider registered (there is no username/password auth in this
 * app by design — docs/adr/0010-authjs-provider-neutral-oidc.md,
 * docs/DECISIONS.md P8). Every entry point into this feature (the page,
 * the server action, and this function itself) independently checks
 * `isDevSignInEnabled()` — never trusting that an earlier check already
 * ran — so this can NEVER activate outside local development, no matter
 * which layer someone tries to reach it from (CLAUDE.md §1.8: server-
 * side enforcement, not UI-only).
 */
export function isDevSignInEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

const DEV_COMPANY_CODE = "DEV-LOCAL";
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60; // matches lib/auth/config.ts's real session maxAge

export interface DevSignInResult {
  sessionToken: string;
  maxAgeSeconds: number;
  userEmail: string;
}

/**
 * Finds or creates one fixed, stable local-dev company and one active
 * user per role within it (never touching or reusing any other
 * company — including any left over from E2E test runs, which always
 * use their own randomly-coded companies), then creates a real database
 * session row for the requested role, exactly the way a real sign-in
 * would via Auth.js's PrismaAdapter (docs/DOMAIN_MODEL.md's Session
 * model) — so the rest of the app (permission checks, company
 * scoping) exercises its real, unmodified code path afterward.
 */
export async function createDevSession(role: UserRole): Promise<DevSignInResult> {
  if (!isDevSignInEnabled()) {
    throw new Error("Dev sign-in is disabled outside local development.");
  }

  const company = await prisma.company.upsert({
    where: { code: DEV_COMPANY_CODE },
    update: {},
    create: { name: "Local Dev Company", code: DEV_COMPANY_CODE },
  });

  let user = await prisma.user.findFirst({
    where: { companyId: company.id, role, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        email: `dev-${role.toLowerCase()}@dev-local.invalid`,
        name: `Dev ${role}`,
        companyId: company.id,
        role,
        status: "ACTIVE",
      },
    });
  }

  const sessionToken = crypto.randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      sessionToken,
      userId: user.id,
      expires: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
    },
  });

  return { sessionToken, maxAgeSeconds: SESSION_MAX_AGE_SECONDS, userEmail: user.email };
}
