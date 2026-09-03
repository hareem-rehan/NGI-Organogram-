/**
 * Error-handling convention for this project (see docs/ARCHITECTURE.md §12):
 *
 * - `AppError` (and subclasses) are EXPECTED errors: something a user or
 *   caller could reasonably trigger (bad input, a business-rule violation,
 *   a missing/invalid config value). Their `message` is safe to show to
 *   the end user.
 * - Anything else (a thrown `Error`, a rejected promise from a library,
 *   a bug) is UNEXPECTED. Its message is never shown to the user directly
 *   — only `toSafeErrorMessage()`'s generic fallback is shown, while the
 *   full error goes to server-side logs via `lib/logger.ts`.
 *
 * Later phases add more specific subclasses (ValidationError,
 * ConflictError, CycleError, ForbiddenError, NotFoundError — per
 * docs/ARCHITECTURE.md §12) as those domains are implemented. Phase 1
 * only needs the base class and the generic fallback.
 */
export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppError";
  }
}

const GENERIC_FALLBACK_MESSAGE =
  "Something went wrong. Please try again, and contact support if the problem continues.";

/**
 * Returns a message safe to render to an end user: the error's own
 * message if it's an expected `AppError`, otherwise a generic fallback
 * that never leaks internal detail (stack traces, file paths, DB errors).
 */
export function toSafeErrorMessage(error: unknown): string {
  if (error instanceof AppError) {
    return error.message;
  }
  return GENERIC_FALLBACK_MESSAGE;
}
