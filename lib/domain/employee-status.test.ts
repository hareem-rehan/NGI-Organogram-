import { describe, expect, it } from "vitest";

import { assignmentDisplayStatus } from "./employee-status";

describe("assignmentDisplayStatus", () => {
  it("returns terminated when the employee is terminated, regardless of assignment state", () => {
    expect(assignmentDisplayStatus("TERMINATED", true, false)).toBe("terminated");
    expect(assignmentDisplayStatus("TERMINATED", false, true)).toBe("terminated");
  });

  it("returns assigned when there is a current assignment", () => {
    expect(assignmentDisplayStatus("ACTIVE", true, false)).toBe("assigned");
  });

  it("returns future when there is no current assignment but a future one exists", () => {
    expect(assignmentDisplayStatus("ACTIVE", false, true)).toBe("future");
  });

  it("returns unassigned when there is neither a current nor a future assignment", () => {
    expect(assignmentDisplayStatus("ACTIVE", false, false)).toBe("unassigned");
  });

  it("returns unassigned for a TRANSFERRED employee with no current assignment", () => {
    expect(assignmentDisplayStatus("TRANSFERRED", false, false)).toBe("unassigned");
  });
});
