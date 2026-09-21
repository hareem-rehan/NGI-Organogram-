import "server-only";
import { PrismaClient } from "@prisma/client";

/**
 * Shared Prisma client instance. Never `new PrismaClient()` anywhere else
 * in the app — in dev, Next.js hot-reloads server modules on every save,
 * and a fresh PrismaClient per reload would each open its own connection
 * pool until the database runs out of connections. Stashing the instance
 * on `globalThis` (guarded so it never happens in production, where the
 * module only loads once anyway) survives hot-reload.
 *
 * Guarded by "server-only" — importing this from client component code
 * fails the build rather than bundling the Postgres connection string
 * into the browser (docs/PROJECT_SPEC.md §13).
 */
declare global {
  var __organogramPrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient = globalThis.__organogramPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__organogramPrisma = prisma;
}
