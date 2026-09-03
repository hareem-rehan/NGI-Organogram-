import { AppError } from "@/lib/errors";

/** The referenced entity does not exist (or isn't visible in this company scope). */
export class NotFoundError extends AppError {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`);
    this.name = "NotFoundError";
  }
}

/** A uniqueness rule was violated (duplicate code, duplicate email, etc.). */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/** A proposed reporting-relationship or department-parent change would create a cycle. */
export class CycleError extends AppError {
  constructor(message: string) {
    super(message);
    this.name = "CycleError";
  }
}

/** Two records that must belong to the same company do not. */
export class CrossCompanyError extends AppError {
  constructor(message: string) {
    super(message);
    this.name = "CrossCompanyError";
  }
}

/** A requested mutation would leave the data in an unsafe/invalid state (e.g. deleting a position with direct reports). */
export class UnsafeMutationError extends AppError {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeMutationError";
  }
}

/** Input failed a domain validation rule (e.g. endDate before startDate). */
export class DomainValidationError extends AppError {
  constructor(message: string) {
    super(message);
    this.name = "DomainValidationError";
  }
}

/** An update targeted a row whose `updatedAt` no longer matches the caller's expected value — someone else changed it first (optimistic concurrency, Phase 12). */
export class StaleUpdateError extends AppError {
  constructor(message: string = "This record was changed by someone else. Reload and try again.") {
    super(message);
    this.name = "StaleUpdateError";
  }
}

/** A requested change would leave the company with zero active ADMINs (Phase 12 last-admin protection). */
export class LastAdminError extends AppError {
  constructor(message: string) {
    super(message);
    this.name = "LastAdminError";
  }
}
