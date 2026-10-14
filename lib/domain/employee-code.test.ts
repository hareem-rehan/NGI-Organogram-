import { describe, expect, it } from "vitest";

import { compareEmployeeCodes } from "./employee-code";

describe("compareEmployeeCodes", () => {
  it("orders the numbers by value, not letter by letter", () => {
    const codes = ["EMP10", "EMP2", "EMP001", "EMP02", "EMP100", "emp3"];
    expect([...codes].sort(compareEmployeeCodes)).toEqual([
      "EMP001",
      "EMP02",
      "EMP2",
      "emp3",
      "EMP10",
      "EMP100",
    ]);
  });

  it("groups different prefixes, numbers sorted within each", () => {
    const codes = ["HR-10", "ENG-2", "HR-9", "ENG-11"];
    expect([...codes].sort(compareEmployeeCodes)).toEqual(["ENG-2", "ENG-11", "HR-9", "HR-10"]);
  });
});
