import { describe, expect, it } from "vitest";

import {
  defaultOrganogramUrlState,
  parseOrganogramUrlState,
  serializeOrganogramUrlState,
  type OrganogramUrlState,
} from "./organogram-url-state";

const POS_ID = "11111111-1111-4111-8111-111111111111";
const DEPT_ID = "22222222-2222-4222-8222-222222222222";
const GRADE_ID = "33333333-3333-4333-8333-333333333333";

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

describe("parseOrganogramUrlState — defaults and valid input", () => {
  it("defaults to Full Company View, no filters, planned on, Visual display", () => {
    const state = defaultOrganogramUrlState();
    expect(state).toEqual({
      view: "full",
      positionId: null,
      departmentId: null,
      depth: 2,
      filters: {
        departmentIds: new Set(),
        levels: new Set(),
        jobGradeIds: new Set(),
        occupancy: "all",
        statuses: new Set(),
      },
      planned: true,
      display: "visual",
    });
  });

  it("parses a valid Position Focus URL", () => {
    const state = parseOrganogramUrlState(params(`view=position&position=${POS_ID}&depth=3`));
    expect(state.view).toBe("position");
    expect(state.positionId).toBe(POS_ID);
    expect(state.depth).toBe(3);
  });

  it("parses a valid Department Focus URL", () => {
    const state = parseOrganogramUrlState(params(`view=department&department=${DEPT_ID}`));
    expect(state.view).toBe("department");
    expect(state.departmentId).toBe(DEPT_ID);
  });

  it("parses valid combined filters", () => {
    const state = parseOrganogramUrlState(
      params(
        `departments=${DEPT_ID}&levels=1,2&grades=${GRADE_ID},none&occupancy=vacant&statuses=ACTIVE,PLANNED`
      )
    );
    expect(state.filters.departmentIds).toEqual(new Set([DEPT_ID]));
    expect(state.filters.levels).toEqual(new Set([1, 2]));
    expect(state.filters.jobGradeIds).toEqual(new Set([GRADE_ID, null]));
    expect(state.filters.occupancy).toBe("vacant");
    expect(state.filters.statuses).toEqual(new Set(["ACTIVE", "PLANNED"]));
  });

  it("parses depth=all", () => {
    expect(parseOrganogramUrlState(params("view=position&depth=all")).depth).toBe("all");
  });

  it("parses display=outline", () => {
    expect(parseOrganogramUrlState(params("display=outline")).display).toBe("outline");
  });

  it("parses planned=false", () => {
    expect(parseOrganogramUrlState(params("planned=false")).planned).toBe(false);
  });
});

describe("parseOrganogramUrlState — invalid input falls back safely", () => {
  it("an invalid position id falls back to null, not a passthrough", () => {
    const state = parseOrganogramUrlState(params("view=position&position=not-a-uuid"));
    expect(state.positionId).toBeNull();
  });

  it("an invalid department id falls back to null", () => {
    const state = parseOrganogramUrlState(params("view=department&department=not-a-uuid"));
    expect(state.departmentId).toBeNull();
  });

  it("an invalid depth falls back to the default (2)", () => {
    expect(parseOrganogramUrlState(params("depth=999")).depth).toBe(2);
    expect(parseOrganogramUrlState(params("depth=-1")).depth).toBe(2);
    expect(parseOrganogramUrlState(params("depth=abc")).depth).toBe(2);
  });

  it("an unknown view value falls back to full", () => {
    expect(parseOrganogramUrlState(params("view=nonsense")).view).toBe("full");
  });

  it("an invalid occupancy value falls back to all", () => {
    expect(parseOrganogramUrlState(params("occupancy=nonsense")).filters.occupancy).toBe("all");
  });

  it("an invalid status entry is dropped, not the whole list", () => {
    const state = parseOrganogramUrlState(params("statuses=ACTIVE,NONSENSE,PLANNED"));
    expect(state.filters.statuses).toEqual(new Set(["ACTIVE", "PLANNED"]));
  });

  it("unknown/extra parameters are silently ignored, never crash parsing", () => {
    expect(() =>
      parseOrganogramUrlState(params("view=full&unknownParam=xyz&another=1"))
    ).not.toThrow();
    expect(parseOrganogramUrlState(params("unknownParam=xyz")).view).toBe("full");
  });

  it("an excessively long parameter value is rejected, not partially parsed", () => {
    const state = parseOrganogramUrlState(params(`departments=${"a".repeat(3000)}`));
    expect(state.filters.departmentIds).toEqual(new Set());
  });

  it("an excessive number of values in a list param is rejected wholesale", () => {
    const many = Array.from({ length: 60 }, () => DEPT_ID).join(",");
    const state = parseOrganogramUrlState(params(`departments=${many}`));
    expect(state.filters.departmentIds).toEqual(new Set());
  });

  it("no positionId is exposed when view is not position, even if a position param is present", () => {
    const state = parseOrganogramUrlState(params(`view=full&position=${POS_ID}`));
    expect(state.positionId).toBeNull();
  });
});

describe("serializeOrganogramUrlState round-trip", () => {
  it("round-trips a Position Focus state through parse -> serialize -> parse", () => {
    const original = parseOrganogramUrlState(
      params(`view=position&position=${POS_ID}&depth=3&occupancy=vacant`)
    );
    const roundTripped = parseOrganogramUrlState(serializeOrganogramUrlState(original));
    expect(roundTripped).toEqual(original);
  });

  it("round-trips a Department Focus state with combined filters", () => {
    const original = parseOrganogramUrlState(
      params(
        `view=department&department=${DEPT_ID}&levels=2,3&grades=${GRADE_ID},none&statuses=ACTIVE&planned=false&display=outline`
      )
    );
    const roundTripped = parseOrganogramUrlState(serializeOrganogramUrlState(original));
    expect(roundTripped).toEqual(original);
  });

  it("the default state serializes to an empty URL", () => {
    const params2 = serializeOrganogramUrlState(defaultOrganogramUrlState());
    expect([...params2.keys()]).toEqual([]);
  });

  it("never includes companyId, employee name/email, or a free-text query field in the serialized output", () => {
    const state: OrganogramUrlState = {
      ...defaultOrganogramUrlState(),
      view: "position",
      positionId: POS_ID,
    };
    const serialized = serializeOrganogramUrlState(state);
    const keys = [...serialized.keys()];
    expect(keys).not.toContain("companyId");
    expect(keys).not.toContain("q");
    expect(keys).not.toContain("query");
    expect(keys).not.toContain("email");
    expect(keys).not.toContain("name");
  });
});
