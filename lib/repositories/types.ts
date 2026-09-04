import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Every repository/service function that writes accepts this instead of
 * hard-coding the module-level `prisma` singleton, so callers can compose
 * multiple repository calls into one `prisma.$transaction(...)` block
 * (docs/adr/0005-transaction-strategy.md). Read-only functions default to
 * the shared client when no transaction is supplied.
 */
export type DbClient = PrismaClient | Prisma.TransactionClient;
