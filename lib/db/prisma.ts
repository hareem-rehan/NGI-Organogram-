import "server-only";
import { PrismaClient } from "@prisma/client";

import { runtimeDatabaseUrl } from "@/lib/db/runtime-database-url";

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

function createClient(): PrismaClient {
  // On Supabase, always the transaction pooler (lib/db/runtime-database-url.ts).
  const { url, rewritten } = runtimeDatabaseUrl(process.env.DATABASE_URL);
  if (rewritten) {
    console.warn(
      "DATABASE_URL points at Supabase's session pooler; using the transaction pooler (port 6543) instead."
    );
  }
  return url ? new PrismaClient({ datasourceUrl: url }) : new PrismaClient();
}

export const prisma: PrismaClient = globalThis.__organogramPrisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__organogramPrisma = prisma;
}
