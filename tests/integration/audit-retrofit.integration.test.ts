import { describe, expect, it } from "vitest";

import {
  makeChildPosition,
  makeCompany,
  makeDepartment,
  makeEmployee,
  makeRootPosition,
  makeUser,
} from "./fixtures";
import { queryAuditEvents } from "@/lib/services/audit.service";
import {
  archiveDepartment,
  createDepartment,
  moveDepartment,
  reactivateDepartment,
  updateDepartment,
} from "@/lib/services/department.service";
import {
  activatePosition,
  archivePosition,
  createPosition,
  movePosition,
  updatePosition,
} from "@/lib/services/hierarchy.service";
import {
  changeEmployeeStatus,
  createEmployee,
  terminateEmployee,
  updateEmployee,
} from "@/lib/services/employee.service";
import {
  createAssignment,
  endAssignment,
  transferEmployee,
} from "@/lib/services/assignment.service";

/**
 * Proves the Phase 12 audit retrofit actually fires for each of the four
 * core mutating services (Department/Position/Employee/Assignment), not
 * just that the OLD (pre-Phase-12) tests for those services still pass
 * unmodified — this is the "positive" half of the retrofit's coverage.
 */
describe("audit retrofit — Department/Position/Employee/Assignment", () => {
  async function latestEventFor(companyId: string, entityType: string, entityId: string) {
    const result = await queryAuditEvents({ companyId, role: "ADMIN", entityType, entityId });
    return result.events[0] ?? null;
  }

  it("Department: create/update/move/archive/reactivate each produce a correctly-attributed audit event", async () => {
    const company = await makeCompany();
    const user = await makeUser(company.id);
    const actor = { userId: user.id, displayName: user.name, email: user.email };

    const dept = await createDepartment({
      companyId: company.id,
      actor,
      name: "Engineering",
      code: "ENG",
    });
    let event = await latestEventFor(company.id, "Department", dept.id);
    expect(event?.action).toBe("CREATED");
    expect(event?.category).toBe("DEPARTMENT");
    expect(event?.actorUserId).toBe(user.id);

    const updated = await updateDepartment({
      companyId: company.id,
      actor,
      departmentId: dept.id,
      name: "Engineering Team",
    });
    event = await latestEventFor(company.id, "Department", updated.id);
    expect(event?.action).toBe("UPDATED");
    expect(event?.changedFields).toEqual(["name"]);

    const otherDept = await createDepartment({
      companyId: company.id,
      actor,
      name: "Ops",
      code: "OPS",
    });
    const moved = await moveDepartment({
      companyId: company.id,
      actor,
      departmentId: dept.id,
      newParentDepartmentId: otherDept.id,
    });
    event = await latestEventFor(company.id, "Department", moved.id);
    expect(event?.action).toBe("UPDATED");
    expect(event?.changedFields).toContain("parentDepartmentId");

    const archived = await archiveDepartment(dept.id, company.id, actor);
    event = await latestEventFor(company.id, "Department", archived.id);
    expect(event?.action).toBe("ARCHIVED");

    const reactivated = await reactivateDepartment(dept.id, company.id, actor);
    event = await latestEventFor(company.id, "Department", reactivated.id);
    expect(event?.action).toBe("REACTIVATED");
  });

  it("Position: create/update/move/archive/activate each produce a correctly-categorized audit event", async () => {
    const company = await makeCompany();
    const user = await makeUser(company.id);
    const actor = { userId: user.id, displayName: user.name, email: user.email };
    const dept = await makeDepartment(company.id);

    const root = await createPosition({
      companyId: company.id,
      actor,
      departmentId: dept.id,
      title: "CEO",
      positionCode: "POS-CEO",
      primaryReportsToPositionId: null,
    });
    let event = await latestEventFor(company.id, "Position", root.id);
    expect(event?.action).toBe("CREATED");
    expect(event?.category).toBe("POSITION");

    const child = await createPosition({
      companyId: company.id,
      actor,
      departmentId: dept.id,
      title: "VP",
      positionCode: "POS-VP",
      primaryReportsToPositionId: root.id,
    });

    const updated = await updatePosition({
      companyId: company.id,
      actor,
      positionId: child.id,
      title: "SVP",
    });
    event = await latestEventFor(company.id, "Position", updated.id);
    expect(event?.action).toBe("UPDATED");
    expect(event?.category).toBe("POSITION");
    expect(event?.changedFields).toEqual(["title"]);

    const grandchild = await createPosition({
      companyId: company.id,
      actor,
      departmentId: dept.id,
      title: "Director",
      positionCode: "POS-DIR",
      primaryReportsToPositionId: child.id,
    });
    const moved = await movePosition({
      companyId: company.id,
      actor,
      positionId: grandchild.id,
      newParentPositionId: root.id,
    });
    event = await latestEventFor(company.id, "Position", moved.id);
    expect(event?.action).toBe("UPDATED");
    expect(event?.category).toBe("HIERARCHY");

    const archived = await archivePosition(child.id, company.id, actor);
    event = await latestEventFor(company.id, "Position", archived.id);
    expect(event?.action).toBe("ARCHIVED");
    expect(event?.category).toBe("POSITION");

    const activated = await activatePosition(child.id, company.id, actor);
    event = await latestEventFor(company.id, "Position", activated.id);
    expect(event?.action).toBe("REACTIVATED");
  });

  it("Employee: create/update/status-change/terminate each produce an EMPLOYEE-category audit event, and termination also audits the ended assignment", async () => {
    const company = await makeCompany();
    const user = await makeUser(company.id);
    const actor = { userId: user.id, displayName: user.name, email: user.email };
    const dept = await makeDepartment(company.id);
    const position = await createPosition({
      companyId: company.id,
      actor,
      departmentId: dept.id,
      title: "Engineer",
      positionCode: "POS-ENG",
      primaryReportsToPositionId: null,
    });

    const employee = await createEmployee({
      companyId: company.id,
      actor,
      employeeCode: "E001",
      firstName: "Ada",
      lastName: "Lovelace",
    });
    let event = await latestEventFor(company.id, "Employee", employee.id);
    expect(event?.action).toBe("CREATED");
    expect(event?.category).toBe("EMPLOYEE");

    const updated = await updateEmployee({
      companyId: company.id,
      actor,
      employeeId: employee.id,
      lastName: "King",
    });
    event = await latestEventFor(company.id, "Employee", updated.id);
    expect(event?.action).toBe("UPDATED");
    expect(event?.changedFields).toEqual(["lastName"]);

    await changeEmployeeStatus(employee.id, company.id, "ACTIVE", actor);
    event = await latestEventFor(company.id, "Employee", employee.id);
    expect(event?.action).toBe("UPDATED");

    await createAssignment({
      companyId: company.id,
      actor,
      employeeId: employee.id,
      positionId: position.id,
      startDate: new Date("2026-01-01"),
    });

    const result = await terminateEmployee({
      companyId: company.id,
      actor,
      employeeId: employee.id,
      terminationDate: new Date("2026-06-01"),
    });
    event = await latestEventFor(company.id, "Employee", employee.id);
    expect(event?.action).toBe("TERMINATED");
    expect(event?.category).toBe("EMPLOYEE");

    expect(result.endedAssignmentId).not.toBeNull();
    const assignmentEvent = await latestEventFor(
      company.id,
      "PositionAssignment",
      result.endedAssignmentId!
    );
    expect(assignmentEvent?.action).toBe("ASSIGNMENT_ENDED");
    expect(assignmentEvent?.category).toBe("ASSIGNMENT");
  });

  it("Assignment: assign/end/transfer each produce an ASSIGNMENT-category audit event", async () => {
    const company = await makeCompany();
    const user = await makeUser(company.id);
    const actor = { userId: user.id, displayName: user.name, email: user.email };
    const dept = await makeDepartment(company.id);
    const root = await makeRootPosition(company.id, dept.id);
    const posA = await makeChildPosition(company.id, dept.id, root.id, 1, {
      positionCode: "POS-A",
    });
    const posB = await makeChildPosition(company.id, dept.id, root.id, 1, {
      positionCode: "POS-B",
    });
    const employee = await makeEmployee(company.id);

    const assignment = await createAssignment({
      companyId: company.id,
      actor,
      employeeId: employee.id,
      positionId: posA.id,
      startDate: new Date("2026-01-01"),
    });
    let event = await latestEventFor(company.id, "PositionAssignment", assignment.id);
    expect(event?.action).toBe("ASSIGNED");
    expect(event?.category).toBe("ASSIGNMENT");

    const { ended, started } = await transferEmployee({
      companyId: company.id,
      actor,
      employeeId: employee.id,
      fromAssignmentId: assignment.id,
      toPositionId: posB.id,
      transferDate: new Date("2026-03-01"),
    });
    event = await latestEventFor(company.id, "PositionAssignment", started.id);
    expect(event?.action).toBe("TRANSFERRED");

    const finalEnd = await endAssignment(started.id, company.id, new Date("2026-06-01"), actor);
    event = await latestEventFor(company.id, "PositionAssignment", finalEnd.id);
    expect(event?.action).toBe("ASSIGNMENT_ENDED");
    expect(ended.id).toBe(assignment.id);
  });

  it("a mutation performed without an explicit actor is attributed to SYSTEM, never silently unaudited", async () => {
    const company = await makeCompany();
    const dept = await createDepartment({ companyId: company.id, name: "Ops", code: "OPS" });
    const event = await latestEventFor(company.id, "Department", dept.id);
    expect(event?.actorType).toBe("SYSTEM");
    expect(event?.actorUserId).toBeNull();
  });
});
