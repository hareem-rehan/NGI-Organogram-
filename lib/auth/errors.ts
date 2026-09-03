import { AppError } from "@/lib/errors";

/** No session at all, or the session could not be validated. */
export class UnauthenticatedError extends AppError {
  constructor(message = "You must be signed in to do that.") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

/** A session exists, but the account is disabled. */
export class InactiveUserError extends AppError {
  constructor(message = "This account has been disabled.") {
    super(message);
    this.name = "InactiveUserError";
  }
}

/** Authenticated and active, but missing the required permission. */
export class ForbiddenError extends AppError {
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}
