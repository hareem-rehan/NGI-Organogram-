// No "server-only" import here: unlike lib/env.server.ts or lib/db/prisma.ts,
// this module holds no secret or database handle of its own — it only maps
// errors to safe messages — so there is nothing for the guard to protect,
// and a direct guard would make it un-mockable in the standard unit config
// (see lib/auth/current-user.ts's identical documented tradeoff). It is
// only ever called from "use server" action files, which Next.js itself
// already refuses to bundle into client code.
import { ZodError } from "zod";

import { AppError } from "@/lib/errors";
import { ForbiddenError, InactiveUserError, UnauthenticatedError } from "@/lib/auth/errors";
import { logger } from "@/lib/logger";

export type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      fieldErrors?: Record<string, string>;
      authRedirect?: "/sign-in" | "/access-denied";
    };

const GENERIC_FALLBACK_MESSAGE =
  "Something went wrong. Please try again, and contact support if the problem continues.";
const VALIDATION_FALLBACK_MESSAGE = "Please fix the highlighted fields and try again.";

/**
 * Wraps a server action body so every mutation/query in the app maps
 * errors the same safe way: malformed input (including unknown fields,
 * since every schema is `.strict()`) becomes a field-level validation
 * result, expected `AppError`s surface their own message, authorization
 * failures map to a redirect hint the client component follows (session
 * expired mid-action, not a page-load redirect), and anything else is
 * logged server-side and replaced with a generic message — never a raw
 * stack trace or database error reaching the browser (CLAUDE.md
 * §1.8/1.11).
 */
export async function runAction<T>(operation: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await operation();
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of error.issues) {
        const key = issue.path.join(".") || "_form";
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      return { ok: false, error: VALIDATION_FALLBACK_MESSAGE, fieldErrors };
    }
    if (error instanceof UnauthenticatedError || error instanceof InactiveUserError) {
      return { ok: false, error: error.message, authRedirect: "/sign-in" };
    }
    if (error instanceof ForbiddenError) {
      return { ok: false, error: error.message, authRedirect: "/access-denied" };
    }
    if (error instanceof AppError) {
      return { ok: false, error: error.message };
    }
    logger.error("unexpected error in server action", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return { ok: false, error: GENERIC_FALLBACK_MESSAGE };
  }
}
