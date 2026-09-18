import { describe, expect, it } from "vitest";

import {
  dateRangesOverlap,
  findOverlappingRange,
  isVacantOnDate,
  rangeCoversDate,
  validateAssignmentDateRange,
} from "./assignment";
import { DomainValidationError } from "./errors";

const d = (s: string) => new Date(s);

describe("validateAssignmentDateRange", () => {
  it("accepts a valid range", () => {
    expect(() =>
      validateAssignmentDateRange({ startDate: d("2023-01-01"), endDate: d("2023-06-01") })
    ).not.toThrow();
  });

  it("accepts an open-ended range", () => {
    expect(() =>
      validateAssignmentDateRange({ startDate: d("2023-01-01"), endDate: null })
    ).not.toThrow();
  });

  it("accepts a same-day start and end", () => {
    expect(() =>
      validateAssignmentDateRange({ startDate: d("2023-01-01"), endDate: d("2023-01-01") })
    ).not.toThrow();
  });

  it("rejects endDate before startDate", () => {
    expect(() =>
      validateAssignmentDateRange({ startDate: d("2023-06-01"), endDate: d("2023-01-01") })
    ).toThrow(DomainValidationError);
  });
});

describe("dateRangesOverlap", () => {
  it("detects overlapping closed ranges", () => {
    const a = { startDate: d("2023-01-01"), endDate: d("2023-06-01") };
    const b = { startDate: d("2023-05-01"), endDate: d("2023-12-01") };
    expect(dateRangesOverlap(a, b)).toBe(true);
  });

  it("does not flag adjacent non-overlapping ranges", () => {
    const a = { startDate: d("2023-01-01"), endDate: d("2023-06-01") };
    const b = { startDate: d("2023-07-01"), endDate: null };
    expect(dateRangesOverlap(a, b)).toBe(false);
  });

  it("treats a null endDate as unbounded, overlapping anything after its start", () => {
    const openEnded = { startDate: d("2023-01-01"), endDate: null };
    const later = { startDate: d("2030-01-01"), endDate: null };
    expect(dateRangesOverlap(openEnded, later)).toBe(true);
  });

  it("is symmetric", () => {
    const a = { startDate: d("2023-01-01"), endDate: d("2023-06-01") };
    const b = { startDate: d("2023-05-01"), endDate: d("2023-12-01") };
    expect(dateRangesOverlap(a, b)).toBe(dateRangesOverlap(b, a));
  });

  it("does not flag a same-day handoff as overlapping (endDate is exclusive)", () => {
    // A same-day handoff: one assignment ends on 2023-06-01 and a new one
    // for the same position starts that exact day — this must be allowed,
    // matching the "vacant from the end date forward" semantics used by
    // lib/repositories/employee.repository.ts's
    // listCurrentAssignmentsForEmployees (endDate > onDate, not >=).
    const ending = { startDate: d("2023-01-01"), endDate: d("2023-06-01") };
    const starting = { startDate: d("2023-06-01"), endDate: null };
    expect(dateRangesOverlap(ending, starting)).toBe(false);
    expect(dateRangesOverlap(starting, ending)).toBe(false);
  });

  it("flags two ranges as overlapping when one starts the day before the other ends", () => {
    const a = { startDate: d("2023-01-01"), endDate: d("2023-06-01") };
    const b = { startDate: d("2023-05-31"), endDate: null };
    expect(dateRangesOverlap(a, b)).toBe(true);
  });
});

describe("findOverlappingRange", () => {
  it("returns the first overlapping range", () => {
    const existing = [
      { id: 1, startDate: d("2020-01-01"), endDate: d("2020-06-01") },
      { id: 2, startDate: d("2023-01-01"), endDate: null },
    ];
    const found = findOverlappingRange(existing, { startDate: d("2023-03-01"), endDate: null });
    expect(found?.id).toBe(2);
  });

  it("returns undefined when nothing overlaps", () => {
    const existing = [{ id: 1, startDate: d("2020-01-01"), endDate: d("2020-06-01") }];
    const found = findOverlappingRange(existing, { startDate: d("2023-01-01"), endDate: null });
    expect(found).toBeUndefined();
  });
});

describe("rangeCoversDate", () => {
  it("covers a date within a closed range", () => {
    expect(
      rangeCoversDate({ startDate: d("2023-01-01"), endDate: d("2023-06-01") }, d("2023-03-01"))
    ).toBe(true);
  });

  it("does not cover a date before the range starts", () => {
    expect(rangeCoversDate({ startDate: d("2023-01-01"), endDate: null }, d("2022-12-31"))).toBe(
      false
    );
  });

  it("does not cover a date after the range ends", () => {
    expect(
      rangeCoversDate({ startDate: d("2023-01-01"), endDate: d("2023-06-01") }, d("2023-06-02"))
    ).toBe(false);
  });

  it("does not cover the range's own end date (endDate is exclusive)", () => {
    expect(
      rangeCoversDate({ startDate: d("2023-01-01"), endDate: d("2023-06-01") }, d("2023-06-01"))
    ).toBe(false);
  });

  it("covers any date on/after the start when open-ended", () => {
    expect(rangeCoversDate({ startDate: d("2023-01-01"), endDate: null }, d("2099-01-01"))).toBe(
      true
    );
  });
});

describe("isVacantOnDate", () => {
  it("is vacant when there are no assignments at all", () => {
    expect(isVacantOnDate([], d("2023-01-01"))).toBe(true);
  });

  it("is not vacant when an assignment covers the date", () => {
    const assignments = [{ startDate: d("2023-01-01"), endDate: null }];
    expect(isVacantOnDate(assignments, d("2023-06-01"))).toBe(false);
  });

  it("is vacant again after the covering assignment's end date", () => {
    const assignments = [{ startDate: d("2023-01-01"), endDate: d("2023-06-01") }];
    expect(isVacantOnDate(assignments, d("2023-07-01"))).toBe(true);
  });

  it("is vacant exactly on the covering assignment's end date (endDate is exclusive)", () => {
    const assignments = [{ startDate: d("2023-01-01"), endDate: d("2023-06-01") }];
    expect(isVacantOnDate(assignments, d("2023-06-01"))).toBe(true);
  });

  it("is vacant before any assignment's start date (boundary)", () => {
    const assignments = [{ startDate: d("2023-06-01"), endDate: null }];
    expect(isVacantOnDate(assignments, d("2023-01-01"))).toBe(true);
  });
});
