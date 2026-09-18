import { DomainValidationError } from "@/lib/domain/errors";

/**
 * Pure position-assignment business rules (docs/DOMAIN_MODEL.md §6). No
 * Prisma import — operates on plain date ranges already fetched by the
 * caller. The DB-aware orchestration (row locking, the transaction, the
 * partial-unique-index concurrency guard) lives in
 * lib/services/assignment.service.ts.
 */

export interface DateRange {
  startDate: Date;
  /** null means open-ended (still active). */
  endDate: Date | null;
}

/** Throws if endDate is earlier than startDate. A same-day start/end is allowed. */
export function validateAssignmentDateRange(range: DateRange): void {
  if (range.endDate !== null && range.endDate < range.startDate) {
    throw new DomainValidationError(
      `Assignment endDate (${range.endDate.toISOString()}) cannot be earlier than startDate (${range.startDate.toISOString()}).`
    );
  }
}

/**
 * Standard half-open interval overlap check, treating a null end as
 * "unbounded / still open." `endDate` is exclusive — a range [start, end)
 * does not cover `end` itself, matching the "vacant from the end date
 * forward" semantics used everywhere else a position/employee's current
 * occupancy is derived (e.g. lib/repositories/employee.repository.ts's
 * `listCurrentAssignmentsForEmployees`: `endDate IS NULL OR endDate >
 * onDate`). This means a new assignment may validly start on the exact
 * calendar date an old one there ended (a same-day handoff) — it must
 * NOT be flagged as overlapping.
 */
export function dateRangesOverlap(a: DateRange, b: DateRange): boolean {
  const aEnd = a.endDate ?? null;
  const bEnd = b.endDate ?? null;
  const aStartsBeforeBEnds = bEnd === null || a.startDate < bEnd;
  const bStartsBeforeAEnds = aEnd === null || b.startDate < aEnd;
  return aStartsBeforeBEnds && bStartsBeforeAEnds;
}

/** Returns the first range in `existing` that overlaps `candidate`, or undefined if none. */
export function findOverlappingRange<T extends DateRange>(
  existing: readonly T[],
  candidate: DateRange
): T | undefined {
  return existing.find((range) => dateRangesOverlap(range, candidate));
}

/**
 * Is `onDate` covered by this range? `endDate` is exclusive — a range
 * [startDate, endDate) does not cover `endDate` itself (startDate <=
 * onDate < endDate, or endDate is open-ended), matching `dateRangesOverlap`
 * above.
 */
export function rangeCoversDate(range: DateRange, onDate: Date): boolean {
  if (onDate < range.startDate) return false;
  if (range.endDate !== null && onDate >= range.endDate) return false;
  return true;
}

/**
 * A position is vacant on `onDate` iff none of its PRIMARY assignments
 * cover that date. Callers must pre-filter `primaryAssignments` to
 * isPrimary=true rows for the position in question — this function
 * doesn't know about isPrimary/positionId, it just checks date coverage,
 * so it stays reusable and trivially testable.
 */
export function isVacantOnDate(primaryAssignments: readonly DateRange[], onDate: Date): boolean {
  return !primaryAssignments.some((range) => rangeCoversDate(range, onDate));
}
