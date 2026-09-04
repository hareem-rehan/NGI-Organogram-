import { describe, expect, it } from "vitest";

import {
  activatePosition,
  archivePosition,
  createPosition,
  deletePosition,
  movePosition,
  updatePosition,
} from "@/lib/services/hierarchy.service";
import {
  getPositionAncestorChain,
  getPositionSubtree,
  listOccupiedPositionIds,
  searchEligiblePositions,
  searchPositions,
} from "@/lib/repositories/position.repository";
import { buildReportingPath } from "@/lib/domain/hierarchy";
import {
  CrossCompanyError,
  CycleError,
  NotFoundError,
  UnsafeMutationError,
} from "@/lib/domain/errors";
import { testPrisma } from "./setup";
import {
  makeChildPosition,
  makeCompany,
  makeDepartment,
  makeEmployee,
  makeRootPosition,
} from "./fixtures";

describe("Position hierarchy", () => {
  it("creates a valid root position at level 1", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const root = await createPosition({
      companyId: company.id,
      departmentId: dept.id,
      title: "CEO",
      positionCode: "POS-CEO",
      primaryReportsToPositionId: null,
    });
    expect(root.organizationalLevel).toBe(1);
    expect(root.primaryReportsToPositionId).toBeNull();
  });

  it("creates a valid child position at parent level + 1", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const root = await makeRootPosition(company.id, dept.id);
    const child = await createPosition({
      companyId: company.id,
      departmentId: dept.id,
      title: "VP",
      positionCode: "POS-VP",
      primaryReportsToPositionId: root.id,
    });
    expect(child.organizationalLevel).toBe(2);
  });

  it("creates a valid multi-level hierarchy with correct levels at every depth", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const root = await makeRootPosition(company.id, dept.id);
    const l2 = await createPosition({
      companyId: company.id,
      departmentId: dept.id,
      title: "VP",
      positionCode: "POS-L2",
      primaryReportsToPositionId: root.id,
    });
    const l3 = await createPosition({
      companyId: company.id,
      departmentId: dept.id,
      title: "Manager",
      positionCode: "POS-L3",
      primaryReportsToPositionId: l2.id,
    });
    const l4 = await createPosition({
      companyId: company.id,
      departmentId: dept.id,
      title: "IC",
      positionCode: "POS-L4",
      primaryReportsToPositionId: l3.id,
    });
    expect([
      root.organizationalLevel,
      l2.organizationalLevel,
      l3.organizationalLevel,
      l4.organizationalLevel,
    ]).toEqual([1, 2, 3, 4]);
  });

  it("rejects a duplicate position code within a company", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    await makeRootPosition(company.id, dept.id, { positionCode: "POS-1" });
    await expect(
      createPosition({
        companyId: company.id,
        departmentId: dept.id,
        title: "Someone",
        positionCode: "pos-1",
        primaryReportsToPositionId: null,
      })
    ).rejects.toThrow(/already in use/);
  });

  it("rejects a second active root position for the same company, with a message naming the actual conflict", async () => {
    // Regression test for a real bug (found during Phase 5 E2E
    // verification, docs/phase-reports/PHASE_05_POSITION_AND_HIERARCHY.md):
    // Prisma reports this hand-authored partial-unique-index violation's
    // `meta.target` as `["companyId"]` only — never the constraint's own
    // SQL name — so a naive `target.includes("one_root_per_company")`
    // check never matches and silently fell through to the generic
    // "position code already in use" message, which is actively
    // misleading here since the code ISN'T a duplicate.
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    await makeRootPosition(company.id, dept.id, { positionCode: "POS-ROOT-1" });
    await expect(
      createPosition({
        companyId: company.id,
        departmentId: dept.id,
        title: "Second Root",
        positionCode: "POS-ROOT-2",
        primaryReportsToPositionId: null,
      })
    ).rejects.toThrow(/already has a root position/i);
  });

  it("rejects self-reporting on move", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const root = await makeRootPosition(company.id, dept.id);
    await expect(
      movePosition({ companyId: company.id, positionId: root.id, newParentPositionId: root.id })
    ).rejects.toBeInstanceOf(CycleError);
  });

  it("rejects a direct two-position cycle", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const a = await makeRootPosition(company.id, dept.id, { positionCode: "POS-A" });
    const b = await makeChildPosition(company.id, dept.id, a.id, 1, { positionCode: "POS-B" });
    await expect(
      movePosition({ companyId: company.id, positionId: a.id, newParentPositionId: b.id })
    ).rejects.toBeInstanceOf(CycleError);
  });

  it("rejects a deep indirect cycle (A->B->C, then A moved under C)", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const a = await makeRootPosition(company.id, dept.id, { positionCode: "POS-A" });
    const b = await makeChildPosition(company.id, dept.id, a.id, 1, { positionCode: "POS-B" });
    const c = await makeChildPosition(company.id, dept.id, b.id, 2, { positionCode: "POS-C" });
    await expect(
      movePosition({ companyId: company.id, positionId: a.id, newParentPositionId: c.id })
    ).rejects.toBeInstanceOf(CycleError);
  });

  it("rejects a cross-company manager assignment", async () => {
    const companyA = await makeCompany();
    const companyB = await makeCompany();
    const deptA = await makeDepartment(companyA.id);
    const rootB = await makeRootPosition(companyB.id, (await makeDepartment(companyB.id)).id);
    await expect(
      createPosition({
        companyId: companyA.id,
        departmentId: deptA.id,
        title: "Should Fail",
        positionCode: "POS-X",
        primaryReportsToPositionId: rootB.id,
      })
    ).rejects.toBeInstanceOf(CrossCompanyError);
  });

  it("rejects a position referencing a missing (non-existent) department", async () => {
    const company = await makeCompany();
    await expect(
      createPosition({
        companyId: company.id,
        departmentId: "00000000-0000-0000-0000-000000000000",
        title: "Should Fail",
        positionCode: "POS-X",
        primaryReportsToPositionId: null,
      })
    ).rejects.toBeInstanceOf(CrossCompanyError);
  });

  it("rejects a position referencing a missing (non-existent) manager", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    await expect(
      createPosition({
        companyId: company.id,
        departmentId: dept.id,
        title: "Should Fail",
        positionCode: "POS-X",
        primaryReportsToPositionId: "00000000-0000-0000-0000-000000000000",
      })
    ).rejects.toBeInstanceOf(CrossCompanyError);
  });

  it("recalculates level and reporting path correctly after a manager change", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const root = await makeRootPosition(company.id, dept.id, { positionCode: "POS-ROOT" });
    const branchA = await makeChildPosition(company.id, dept.id, root.id, 1, {
      positionCode: "POS-A",
    });
    const branchB = await makeChildPosition(company.id, dept.id, root.id, 1, {
      positionCode: "POS-B",
    });
    const moved = await makeChildPosition(company.id, dept.id, branchA.id, 2, {
      positionCode: "POS-MOVED",
    });

    expect(moved.organizationalLevel).toBe(3);

    await movePosition({
      companyId: company.id,
      positionId: moved.id,
      newParentPositionId: branchB.id,
    });

    const updated = await testPrisma.position.findUniqueOrThrow({ where: { id: moved.id } });
    expect(updated.organizationalLevel).toBe(3); // same depth under the new branch
    expect(updated.primaryReportsToPositionId).toBe(branchB.id);
  });

  it("recalculates every descendant's level when an intermediate branch is moved", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const root = await makeRootPosition(company.id, dept.id, { positionCode: "POS-ROOT" });
    const branchA = await makeChildPosition(company.id, dept.id, root.id, 1, {
      positionCode: "POS-A",
    });
    const branchB = await makeChildPosition(company.id, dept.id, root.id, 1, {
      positionCode: "POS-B",
    });
    const mid = await makeChildPosition(company.id, dept.id, branchA.id, 2, {
      positionCode: "POS-MID",
    });
    const leaf = await makeChildPosition(company.id, dept.id, mid.id, 3, {
      positionCode: "POS-LEAF",
    });

    await movePosition({
      companyId: company.id,
      positionId: mid.id,
      newParentPositionId: branchB.id,
    });

    const updatedMid = await testPrisma.position.findUniqueOrThrow({ where: { id: mid.id } });
    const updatedLeaf = await testPrisma.position.findUniqueOrThrow({ where: { id: leaf.id } });
    expect(updatedMid.organizationalLevel).toBe(3);
    expect(updatedLeaf.organizationalLevel).toBe(4);
  });

  it("assembles a correct root-first reporting path", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const root = await makeRootPosition(company.id, dept.id, {
      positionCode: "POS-ROOT",
      title: "CEO",
    });
    const mid = await makeChildPosition(company.id, dept.id, root.id, 1, {
      positionCode: "POS-MID",
      title: "VP",
    });
    const leaf = await makeChildPosition(company.id, dept.id, mid.id, 2, {
      positionCode: "POS-LEAF",
      title: "IC",
    });

    const chain = await getPositionAncestorChain(leaf.id, company.id);
    const path = buildReportingPath(chain);

    expect(path.map((p) => p.title)).toEqual(["CEO", "VP", "IC"]);
  });

  it("fetches a full descendant subtree via breadth-first traversal", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const root = await makeRootPosition(company.id, dept.id, { positionCode: "POS-ROOT" });
    const a = await makeChildPosition(company.id, dept.id, root.id, 1, { positionCode: "POS-A" });
    await makeChildPosition(company.id, dept.id, root.id, 1, { positionCode: "POS-B" });
    await makeChildPosition(company.id, dept.id, a.id, 2, { positionCode: "POS-A-CHILD" });

    const subtree = await getPositionSubtree(root.id, company.id);
    expect(subtree).toHaveLength(3);
  });

  it("blocks hard deletion of a position with direct reports", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const root = await makeRootPosition(company.id, dept.id);
    await makeChildPosition(company.id, dept.id, root.id, 1);
    await expect(deletePosition(root.id, company.id)).rejects.toBeInstanceOf(UnsafeMutationError);
  });

  it("allows archiving a position that still has children (hierarchy stays structurally valid)", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const root = await makeRootPosition(company.id, dept.id);
    const child = await makeChildPosition(company.id, dept.id, root.id, 1);

    const archived = await archivePosition(root.id, company.id);
    expect(archived.status).toBe("INACTIVE");

    const stillLinkedChild = await testPrisma.position.findUniqueOrThrow({
      where: { id: child.id },
    });
    expect(stillLinkedChild.primaryReportsToPositionId).toBe(root.id);
  });

  it("reactivates an archived position", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const root = await makeRootPosition(company.id, dept.id);
    await archivePosition(root.id, company.id);
    const reactivated = await activatePosition(root.id, company.id);
    expect(reactivated.status).toBe("ACTIVE");
  });

  it("handles a deep hierarchy traversal (20 levels) without error", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    let current = await makeRootPosition(company.id, dept.id, { positionCode: "POS-0" });
    for (let i = 1; i <= 20; i++) {
      current = await makeChildPosition(company.id, dept.id, current.id, i, {
        positionCode: `POS-${i}`,
      });
    }
    expect(current.organizationalLevel).toBe(21);
    const chain = await getPositionAncestorChain(current.id, company.id);
    expect(chain).toHaveLength(21);
  });

  describe("updatePosition (Phase 5)", () => {
    it("updates title, description, location, and job grade without touching organizationalLevel or Reports-To", async () => {
      const company = await makeCompany();
      const dept = await makeDepartment(company.id);
      const root = await makeRootPosition(company.id, dept.id);
      const child = await makeChildPosition(company.id, dept.id, root.id, 1);

      const updated = await updatePosition({
        companyId: company.id,
        positionId: child.id,
        title: "Renamed Title",
        location: "Remote",
      });

      expect(updated.title).toBe("Renamed Title");
      expect(updated.location).toBe("Remote");
      expect(updated.organizationalLevel).toBe(child.organizationalLevel);
      expect(updated.primaryReportsToPositionId).toBe(root.id);
    });

    it("moves a position to a different department without affecting reporting hierarchy", async () => {
      const company = await makeCompany();
      const deptA = await makeDepartment(company.id, { code: "A" });
      const deptB = await makeDepartment(company.id, { code: "B" });
      const root = await makeRootPosition(company.id, deptA.id);

      const updated = await updatePosition({
        companyId: company.id,
        positionId: root.id,
        departmentId: deptB.id,
      });

      expect(updated.departmentId).toBe(deptB.id);
      expect(updated.primaryReportsToPositionId).toBeNull();
    });

    it("rejects a departmentId from a different company", async () => {
      const company = await makeCompany();
      const other = await makeCompany();
      const dept = await makeDepartment(company.id);
      const foreignDept = await makeDepartment(other.id);
      const root = await makeRootPosition(company.id, dept.id);

      await expect(
        updatePosition({ companyId: company.id, positionId: root.id, departmentId: foreignDept.id })
      ).rejects.toThrow(CrossCompanyError);
    });

    it("rejects updating a position that does not exist in this company", async () => {
      const company = await makeCompany();
      const other = await makeCompany();
      const dept = await makeDepartment(other.id);
      const root = await makeRootPosition(other.id, dept.id);

      await expect(
        updatePosition({ companyId: company.id, positionId: root.id, title: "Hijacked" })
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("searchPositions (Phase 5)", () => {
    it("scopes results to the requesting company only", async () => {
      const company = await makeCompany();
      const other = await makeCompany();
      const dept = await makeDepartment(company.id);
      const foreignDept = await makeDepartment(other.id);
      await makeRootPosition(company.id, dept.id, { positionCode: "MINE" });
      await makeRootPosition(other.id, foreignDept.id, { positionCode: "THEIRS" });

      const result = await searchPositions({ companyId: company.id, page: 1, pageSize: 20 });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.positionCode).toBe("MINE");
    });

    it("filters by department and status", async () => {
      const company = await makeCompany();
      const deptA = await makeDepartment(company.id, { code: "A" });
      const deptB = await makeDepartment(company.id, { code: "B" });
      const root = await makeRootPosition(company.id, deptA.id, { positionCode: "ROOT" });
      const inOther = await makeChildPosition(company.id, deptB.id, root.id, 1, {
        positionCode: "OTHERDEPT",
      });
      await archivePosition(inOther.id, company.id);

      const byDept = await searchPositions({
        companyId: company.id,
        departmentId: deptB.id,
        page: 1,
        pageSize: 20,
      });
      expect(byDept.items.map((p) => p.positionCode)).toEqual(["OTHERDEPT"]);

      const byStatus = await searchPositions({
        companyId: company.id,
        status: "INACTIVE",
        page: 1,
        pageSize: 20,
      });
      expect(byStatus.items.map((p) => p.id)).toEqual([inOther.id]);
    });

    it("filters by case-insensitive title/code search", async () => {
      const company = await makeCompany();
      const dept = await makeDepartment(company.id);
      await makeRootPosition(company.id, dept.id, {
        positionCode: "POS-CEO",
        title: "Chief Executive",
      });

      const result = await searchPositions({
        companyId: company.id,
        search: "chief",
        page: 1,
        pageSize: 20,
      });
      expect(result.items.map((p) => p.positionCode)).toEqual(["POS-CEO"]);
    });

    it("filters by occupancy (Phase 7 dashboard deep-link parameter)", async () => {
      const company = await makeCompany();
      const dept = await makeDepartment(company.id);
      const occupied = await makeRootPosition(company.id, dept.id, { positionCode: "OCC" });
      const vacant = await makeChildPosition(company.id, dept.id, occupied.id, 1, {
        positionCode: "VAC",
      });
      const employee = await makeEmployee(company.id);
      await testPrisma.positionAssignment.create({
        data: {
          companyId: company.id,
          employeeId: employee.id,
          positionId: occupied.id,
          isPrimary: true,
          startDate: new Date("2024-01-01"),
          endDate: null,
        },
      });

      const occupiedResult = await searchPositions({
        companyId: company.id,
        occupancy: "occupied",
        page: 1,
        pageSize: 20,
      });
      expect(occupiedResult.items.map((p) => p.positionCode)).toEqual(["OCC"]);

      const vacantResult = await searchPositions({
        companyId: company.id,
        occupancy: "vacant",
        page: 1,
        pageSize: 20,
      });
      expect(vacantResult.items.map((p) => p.positionCode)).toEqual([vacant.positionCode]);
    });
  });

  describe("listOccupiedPositionIds (Phase 5)", () => {
    it("reports a position with an open-ended primary assignment as occupied", async () => {
      const company = await makeCompany();
      const dept = await makeDepartment(company.id);
      const root = await makeRootPosition(company.id, dept.id);
      const employee = await makeEmployee(company.id);
      await testPrisma.positionAssignment.create({
        data: {
          companyId: company.id,
          employeeId: employee.id,
          positionId: root.id,
          isPrimary: true,
          startDate: new Date("2024-01-01"),
          endDate: null,
        },
      });

      const occupied = await listOccupiedPositionIds([root.id], company.id, new Date());
      expect(occupied.has(root.id)).toBe(true);
    });

    it("does not report a vacant position as occupied", async () => {
      const company = await makeCompany();
      const dept = await makeDepartment(company.id);
      const root = await makeRootPosition(company.id, dept.id);

      const occupied = await listOccupiedPositionIds([root.id], company.id, new Date());
      expect(occupied.has(root.id)).toBe(false);
    });

    it("does not report a position with only a FUTURE-dated assignment as currently occupied", async () => {
      const company = await makeCompany();
      const dept = await makeDepartment(company.id);
      const root = await makeRootPosition(company.id, dept.id);
      const employee = await makeEmployee(company.id);
      const farFuture = new Date();
      farFuture.setFullYear(farFuture.getFullYear() + 1);
      await testPrisma.positionAssignment.create({
        data: {
          companyId: company.id,
          employeeId: employee.id,
          positionId: root.id,
          isPrimary: true,
          startDate: farFuture,
          endDate: null,
        },
      });

      const occupied = await listOccupiedPositionIds([root.id], company.id, new Date());
      expect(occupied.has(root.id)).toBe(false);
    });

    it("does not report a position with only a HISTORICAL (ended) assignment as currently occupied", async () => {
      const company = await makeCompany();
      const dept = await makeDepartment(company.id);
      const root = await makeRootPosition(company.id, dept.id);
      const employee = await makeEmployee(company.id);
      await testPrisma.positionAssignment.create({
        data: {
          companyId: company.id,
          employeeId: employee.id,
          positionId: root.id,
          isPrimary: true,
          startDate: new Date("2020-01-01"),
          endDate: new Date("2021-01-01"),
        },
      });

      const occupied = await listOccupiedPositionIds([root.id], company.id, new Date());
      expect(occupied.has(root.id)).toBe(false);
    });
  });

  describe("searchEligiblePositions (Phase 6)", () => {
    it("excludes an occupied position and includes a vacant one", async () => {
      const company = await makeCompany();
      const dept = await makeDepartment(company.id);
      const occupied = await makeRootPosition(company.id, dept.id, { positionCode: "OCC" });
      const vacant = await makeChildPosition(company.id, dept.id, occupied.id, 1, {
        positionCode: "VAC",
      });
      const employee = await makeEmployee(company.id);
      await testPrisma.positionAssignment.create({
        data: {
          companyId: company.id,
          employeeId: employee.id,
          positionId: occupied.id,
          isPrimary: true,
          startDate: new Date("2023-01-01"),
          endDate: null,
        },
      });

      const results = await searchEligiblePositions(company.id, undefined, new Date());
      const ids = results.map((r) => r.position.id);
      expect(ids).not.toContain(occupied.id);
      expect(ids).toContain(vacant.id);
    });

    it("includes a position whose only assignment has already ended", async () => {
      const company = await makeCompany();
      const dept = await makeDepartment(company.id);
      const position = await makeRootPosition(company.id, dept.id);
      const employee = await makeEmployee(company.id);
      await testPrisma.positionAssignment.create({
        data: {
          companyId: company.id,
          employeeId: employee.id,
          positionId: position.id,
          isPrimary: true,
          startDate: new Date("2020-01-01"),
          endDate: new Date("2021-01-01"),
        },
      });

      const results = await searchEligiblePositions(company.id, undefined, new Date());
      expect(results.map((r) => r.position.id)).toContain(position.id);
    });

    it("includes a position whose prior assignment ends on the exact effective date searched (same-day handoff, Phase 6 regression)", async () => {
      const company = await makeCompany();
      const dept = await makeDepartment(company.id);
      const position = await makeRootPosition(company.id, dept.id);
      const employee = await makeEmployee(company.id);
      await testPrisma.positionAssignment.create({
        data: {
          companyId: company.id,
          employeeId: employee.id,
          positionId: position.id,
          isPrimary: true,
          startDate: new Date("2023-01-01"),
          endDate: new Date("2023-06-01"),
        },
      });

      const results = await searchEligiblePositions(company.id, undefined, new Date("2023-06-01"));
      expect(results.map((r) => r.position.id)).toContain(position.id);
    });

    it("excludes an INACTIVE position but includes a PLANNED one", async () => {
      const company = await makeCompany();
      const dept = await makeDepartment(company.id);
      const inactive = await makeRootPosition(company.id, dept.id, { positionCode: "INACT" });
      await testPrisma.position.update({
        where: { id: inactive.id },
        data: { status: "INACTIVE" },
      });
      const planned = await makeChildPosition(company.id, dept.id, inactive.id, 1, {
        positionCode: "PLAN",
      });
      await testPrisma.position.update({ where: { id: planned.id }, data: { status: "PLANNED" } });

      const results = await searchEligiblePositions(company.id, undefined, new Date());
      const ids = results.map((r) => r.position.id);
      expect(ids).not.toContain(inactive.id);
      expect(ids).toContain(planned.id);
    });

    it("excludes a position in an inactive department", async () => {
      const company = await makeCompany();
      const dept = await makeDepartment(company.id);
      const position = await makeRootPosition(company.id, dept.id);
      await testPrisma.department.update({ where: { id: dept.id }, data: { status: "INACTIVE" } });

      const results = await searchEligiblePositions(company.id, undefined, new Date());
      expect(results.map((r) => r.position.id)).not.toContain(position.id);
    });

    it("scopes results to the requesting company only", async () => {
      const company = await makeCompany();
      const other = await makeCompany();
      const dept = await makeDepartment(company.id);
      const otherDept = await makeDepartment(other.id);
      await makeRootPosition(company.id, dept.id, { positionCode: "MINE" });
      await makeRootPosition(other.id, otherDept.id, { positionCode: "THEIRS" });

      const results = await searchEligiblePositions(company.id, undefined, new Date());
      expect(results.map((r) => r.position.positionCode)).toEqual(["MINE"]);
    });
  });
});
