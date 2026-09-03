import { describe, expect, it } from "vitest";

import { getOrganogramRawData } from "@/lib/repositories/organogram.repository";
import { getOrganogramData } from "@/lib/services/organogram.service";
import { testPrisma } from "./setup";
import {
  makeChildPosition,
  makeCompany,
  makeDepartment,
  makeEmployee,
  makeJobGrade,
  makeRootPosition,
} from "./fixtures";

async function assign(companyId: string, employeeId: string, positionId: string) {
  return testPrisma.positionAssignment.create({
    data: {
      companyId,
      employeeId,
      positionId,
      isPrimary: true,
      startDate: new Date("2020-01-01"),
      endDate: null,
    },
  });
}

describe("organogram repository — company scoping and bulk fetch", () => {
  it("returns only the requesting company's positions/departments/job grades", async () => {
    const company = await makeCompany();
    const other = await makeCompany();
    const dept = await makeDepartment(company.id);
    await makeDepartment(other.id);
    const root = await makeRootPosition(company.id, dept.id);
    const otherDept = await makeDepartment(other.id);
    await makeRootPosition(other.id, otherDept.id);

    const raw = await getOrganogramRawData(company.id, new Date());

    expect(raw.positions.map((p) => p.id)).toEqual([root.id]);
    expect(raw.departments.map((d) => d.id)).toEqual([dept.id]);
  });

  it("maps the currently-effective occupant to a display name, not the raw employee record", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const root = await makeRootPosition(company.id, dept.id);
    const employee = await makeEmployee(company.id, { firstName: "Amara", lastName: "Chen" });
    await assign(company.id, employee.id, root.id);

    const raw = await getOrganogramRawData(company.id, new Date());

    expect(raw.occupantNamesByPositionId.get(root.id)).toBe("Amara Chen");
    expect(raw.occupantEmployeeIdsByPositionId.get(root.id)).toBe(employee.id);
  });

  it("leaves a position with no current assignment absent from the occupant map (vacant)", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const root = await makeRootPosition(company.id, dept.id);

    const raw = await getOrganogramRawData(company.id, new Date());

    expect(raw.occupantNamesByPositionId.has(root.id)).toBe(false);
  });

  it("includes job grade names keyed by id", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const grade = await makeJobGrade(company.id, { name: "Director" });
    const root = await makeRootPosition(company.id, dept.id);
    await testPrisma.position.update({ where: { id: root.id }, data: { jobGradeId: grade.id } });

    const raw = await getOrganogramRawData(company.id, new Date());

    expect(raw.jobGradeNamesById.get(grade.id)).toBe("Director");
  });
});

describe("getOrganogramData — end-to-end against a real hierarchy", () => {
  it("builds a full node/edge graph reflecting department, occupancy, and level data", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id, { name: "Engineering", code: "ENG" });
    const root = await makeRootPosition(company.id, dept.id, { title: "CEO" });
    const child = await makeChildPosition(company.id, dept.id, root.id, 1, { title: "VP Eng" });
    const employee = await makeEmployee(company.id);
    await assign(company.id, employee.id, root.id);

    const result = await getOrganogramData({ companyId: company.id, now: new Date() });

    expect(result.company.code).toBe(company.code);
    expect(result.safety).toEqual({
      hasRoot: true,
      extraRootCount: 0,
      cyclePositionCount: 0,
      disconnectedPositionCount: 0,
    });
    const rootNode = result.nodes.find((n) => n.positionId === root.id);
    const childNode = result.nodes.find((n) => n.positionId === child.id);
    expect(rootNode?.occupancyStatus).toBe("occupied");
    expect(rootNode?.occupantEmployeeId).toBe(employee.id);
    expect(rootNode?.hasChildren).toBe(true);
    expect(childNode?.occupancyStatus).toBe("vacant");
    expect(childNode?.primaryReportsToPositionId).toBe(root.id);
    expect(result.edges).toEqual([
      { sourcePositionId: root.id, targetPositionId: child.id, reportingType: "PRIMARY" },
    ]);
  });

  it("never mixes data across companies — a second company's hierarchy is fully isolated", async () => {
    const companyA = await makeCompany();
    const companyB = await makeCompany();
    const deptA = await makeDepartment(companyA.id);
    const deptB = await makeDepartment(companyB.id);
    await makeRootPosition(companyA.id, deptA.id, { title: "A-Root" });
    await makeRootPosition(companyB.id, deptB.id, { title: "B-Root" });

    const resultA = await getOrganogramData({ companyId: companyA.id, now: new Date() });

    expect(resultA.nodes).toHaveLength(1);
    expect(resultA.nodes[0]?.title).toBe("A-Root");
  });

  it("reports hasRoot: false and empty nodes/edges for a company with no positions yet", async () => {
    const company = await makeCompany();

    const result = await getOrganogramData({ companyId: company.id, now: new Date() });

    expect(result.safety.hasRoot).toBe(false);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("throws for a nonexistent company id rather than returning an empty payload", async () => {
    await expect(
      getOrganogramData({ companyId: "00000000-0000-0000-0000-000000000000" })
    ).rejects.toThrow();
  });
});
