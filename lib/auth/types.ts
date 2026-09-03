import type { UserRole, UserStatus } from "@prisma/client";
import type { DefaultSession } from "next-auth";

/**
 * Augments Auth.js's Session type with the fields lib/auth/config.ts's
 * `session` callback actually attaches (docs/AUTHORIZATION_MATRIX.md).
 * Import this file (for its side effect) wherever the augmented Session
 * type needs to be visible — it's imported by lib/auth/config.ts and
 * lib/auth/current-user.ts, which covers every real usage.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
      status: UserStatus;
      companyId: string;
    } & DefaultSession["user"];
  }
}

/**
 * The Prisma adapter's `AdapterUser` is, at runtime, exactly our Prisma
 * `User` row — this augmentation just tells TypeScript about the extra
 * columns so the `session` callback in lib/auth/config.ts can read them
 * without a cast.
 */
declare module "@auth/core/adapters" {
  interface AdapterUser {
    role: UserRole;
    status: UserStatus;
    companyId: string;
  }
}
