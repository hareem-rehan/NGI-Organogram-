import { describe, expect, it } from "vitest";

import {
  reorderDepartments,
  archiveDepartment,
  createDepartment,
  deleteDepartment,
  moveDepartment,
  reactivateDepartment,
  updateDepartment,
} from "@/lib/services/department.service";
import { searchDepartments } from "@/lib/repositories/department.repository";
import {
  ConflictError,
  CrossCompanyError,
  CycleError,
  NotFoundError,
  UnsafeMutationError,
} from "@/lib/domain/errors";
import { testPrisma } from "./setup";
import { makeCompany, makeDepartment } from "./fixtures";

describe("Department", () => {
  it("creates a valid top-level department", async () => {
    const company = await makeCompany();
    const dept = await createDepartment({
      companyId: company.id,
      name: "Engineering",
      code: "eng",
    });
    expect(dept.code).toBe("ENG");
    expect(dept.parentDepartmentId).toBeNull();
  });

  it("defaults career ladders to both IC and Manager, and stores an explicit choice", async () => {
    const company = await makeCompany();
    const withDefault = await createDepartment({
      companyId: company.id,
      name: "Engineering",
      code: "ENG",
    });
    expect(withDefault.hasIcLadder).toBe(true);
    expect(withDefault.hasManagerLadder).toBe(true);

    const managerOnly = await createDepartment({
      companyId: company.id,
      name: "Project",
      code: "PROJECT",
      hasIcLadder: false,
      hasManagerLadder: true,
    });
    expect(managerOnly.hasIcLadder).toBe(false);
    expect(managerOnly.hasManagerLadder).toBe(true);
  });

  it("updates a department's career ladders to None", async () => {
    const company = await makeCompany();
    const dept = await createDepartment({
      companyId: company.id,
      name: "Founder",
      code: "FOUNDER",
    });
    const updated = await updateDepartment({
      companyId: company.id,
      departmentId: dept.id,
      hasIcLadder: false,
      hasManagerLadder: false,
    });
    expect(updated.hasIcLadder).toBe(false);
    expect(updated.hasManagerLadder).toBe(false);
  });

  it("creates a valid nested department", async () => {
    const company = await makeCompany();
    const parent = await makeDepartment(company.id, { code: "ENG" });
    const child = await createDepartment({
      companyId: company.id,
      name: "Platform",
      code: "ENG-PLATFORM",
      parentDepartmentId: parent.id,
    });
    expect(child.parentDepartmentId).toBe(parent.id);
  });

  it("rejects a duplicate code in the same company", async () => {
    const company = await makeCompany();
    await createDepartment({ companyId: company.id, name: "Engineering", code: "ENG" });
    await expect(
      createDepartment({ companyId: company.id, name: "Eng 2", code: "ENG" })
    ).rejects.toThrow(/already in use/);
  });

  it("allows the same department code in a different company", async () => {
    const companyA = await makeCompany();
    const companyB = await makeCompany();
    await createDepartment({ companyId: companyA.id, name: "Engineering", code: "ENG" });
    await expect(
      createDepartment({ companyId: companyB.id, name: "Engineering", code: "ENG" })
    ).resolves.toMatchObject({ code: "ENG" });
  });

  it("rejects a department set as its own parent", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id, { code: "ENG" });
    await expect(
      moveDepartment({
        companyId: company.id,
        departmentId: dept.id,
        newParentDepartmentId: dept.id,
      })
    ).rejects.toBeInstanceOf(CycleError);
  });

  it("rejects a direct department cycle (A parent of B, then B set as parent of A)", async () => {
    const company = await makeCompany();
    const a = await makeDepartment(company.id, { code: "A" });
    const b = await createDepartment({
      companyId: company.id,
      name: "B",
      code: "B",
      parentDepartmentId: a.id,
    });
    await expect(
      moveDepartment({ companyId: company.id, departmentId: a.id, newParentDepartmentId: b.id })
    ).rejects.toBeInstanceOf(CycleError);
  });

  it("rejects a deep indirect department cycle", async () => {
    const company = await makeCompany();
    const a = await makeDepartment(company.id, { code: "A" });
    const b = await createDepartment({
      companyId: company.id,
      name: "B",
      code: "B",
      parentDepartmentId: a.id,
    });
    const c = await createDepartment({
      companyId: company.id,
      name: "C",
      code: "C",
      parentDepartmentId: b.id,
    });
    await expect(
      moveDepartment({ companyId: company.id, departmentId: a.id, newParentDepartmentId: c.id })
    ).rejects.toBeInstanceOf(CycleError);
  });

  it("rejects a cross-company parent department", async () => {
    const companyA = await makeCompany();
    const companyB = await makeCompany();
    const parentInB = await makeDepartment(companyB.id, { code: "PARENT" });
    await expect(
      createDepartment({
        companyId: companyA.id,
        name: "Child",
        code: "CHILD",
        parentDepartmentId: parentInB.id,
      })
    ).rejects.toBeInstanceOf(CrossCompanyError);
  });

  it("blocks hard deletion while active positions reference the department", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id, { code: "ENG" });
    await testPrisma.position.create({
      data: {
        companyId: company.id,
        departmentId: dept.id,
        title: "CEO",
        positionCode: "POS-1",
        organizationalLevel: 1,
      },
    });
    await expect(deleteDepartment(dept.id, company.id)).rejects.toBeInstanceOf(UnsafeMutationError);
  });

  it("blocks hard deletion while a sub-department still points at it", async () => {
    const company = await makeCompany();
    const parent = await makeDepartment(company.id, { code: "ENG" });
    await testPrisma.department.create({
      data: {
        companyId: company.id,
        code: "PLATFORM",
        name: "Platform",
        parentDepartmentId: parent.id,
      },
    });

    await expect(deleteDepartment(parent.id, company.id)).rejects.toBeInstanceOf(
      UnsafeMutationError
    );
    // The parent is still there — a refused delete changes nothing.
    await expect(
      testPrisma.department.findUnique({ where: { id: parent.id } })
    ).resolves.not.toBeNull();
  });

  it("deletes an empty department and records what was removed, in the same transaction", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id, { code: "TEMP", name: "Temporary Team" });

    await deleteDepartment(dept.id, company.id, "SYSTEM");

    await expect(testPrisma.department.findUnique({ where: { id: dept.id } })).resolves.toBeNull();

    // The row is gone, so the audit event's before-snapshot is the only
    // remaining record of what was deleted. It must therefore exist, and
    // must carry enough to identify the department after the fact.
    const events = await testPrisma.auditEvent.findMany({
      where: { companyId: company.id, action: "DELETED", entityType: "Department" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.entityId).toBe(dept.id);
    expect(events[0]?.entityDisplayReference).toBe("Temporary Team");
    expect(JSON.stringify(events[0]?.beforeData)).toContain("Temporary Team");
    expect(events[0]?.afterData).toBeNull();
  });

  it("writes no audit event when the delete is refused", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id, { code: "ENG" });
    await testPrisma.position.create({
      data: {
        companyId: company.id,
        departmentId: dept.id,
        title: "CEO",
        positionCode: "POS-AUDIT-1",
        organizationalLevel: 1,
      },
    });

    await expect(deleteDepartment(dept.id, company.id)).rejects.toBeInstanceOf(UnsafeMutationError);

    const events = await testPrisma.auditEvent.findMany({
      where: { companyId: company.id, action: "DELETED" },
    });
    expect(events).toEqual([]);
  });

  it("deletes a department whose only leftovers are its own unused levels, and removes them", async () => {
    // Adding a position at a level creates a level just for that department;
    // it stays behind after the position is moved out and used to block the
    // delete with a vague "still referenced" error.
    const company = await makeCompany();
    const dept = await makeDepartment(company.id, { code: "IT" });
    const shared = await testPrisma.jobGrade.create({
      data: { companyId: company.id, code: "L3", name: "Junior" },
    });
    await testPrisma.jobGrade.create({
      data: { companyId: company.id, departmentId: dept.id, code: "L3", name: "Junior" },
    });

    await deleteDepartment(dept.id, company.id);

    await expect(testPrisma.department.findUnique({ where: { id: dept.id } })).resolves.toBeNull();
    await expect(
      testPrisma.jobGrade.findMany({ where: { departmentId: dept.id } })
    ).resolves.toEqual([]);
    // Company-wide levels are never touched.
    await expect(
      testPrisma.jobGrade.findUnique({ where: { id: shared.id } })
    ).resolves.not.toBeNull();
  });

  it("names a level still used elsewhere and changes nothing", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id, { code: "IT" });
    const other = await makeDepartment(company.id, { code: "OPS" });
    const used = await testPrisma.jobGrade.create({
      data: { companyId: company.id, departmentId: dept.id, code: "L6", name: "Senior" },
    });
    const unused = await testPrisma.jobGrade.create({
      data: { companyId: company.id, departmentId: dept.id, code: "L3", name: "Junior" },
    });
    // A position moved to another department kept this department's level.
    await testPrisma.position.create({
      data: {
        companyId: company.id,
        departmentId: other.id,
        jobGradeId: used.id,
        title: "CEO",
        positionCode: "POS-LVL-1",
        organizationalLevel: 1,
      },
    });

    await expect(deleteDepartment(dept.id, company.id)).rejects.toThrow(/L6/);

    // The whole delete rolled back, including the clean-up of unused levels.
    await expect(
      testPrisma.department.findUnique({ where: { id: dept.id } })
    ).resolves.not.toBeNull();
    await expect(
      testPrisma.jobGrade.findUnique({ where: { id: unused.id } })
    ).resolves.not.toBeNull();
  });

  it("names the sub-divisions that block a delete", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id, { code: "DOA" });
    await testPrisma.jobFamily.create({
      data: { companyId: company.id, departmentId: dept.id, code: "ADMIN", name: "Admin" },
    });

    const attempt = deleteDepartment(dept.id, company.id);
    await expect(attempt).rejects.toBeInstanceOf(UnsafeMutationError);
    await expect(attempt).rejects.toThrow(/sub-division Admin/);
  });

  it("generates a code from the name when none is given, numbering it if taken (D51)", async () => {
    const company = await makeCompany();
    const first = await createDepartment({
      companyId: company.id,
      name: "Delivery Org / Administration",
    });
    expect(first.code).toBe("DOA");
    const second = await createDepartment({
      companyId: company.id,
      name: "Data Operations Analytics",
    });
    expect(second.code).toBe("DOA2");
    // A code given explicitly (CSV import) is still used as-is.
    const imported = await createDepartment({
      companyId: company.id,
      name: "Imported",
      code: "imp",
    });
    expect(imported.code).toBe("IMP");
  });

  it("refuses a department name already in use, ignoring case (D52)", async () => {
    const company = await makeCompany();
    await createDepartment({ companyId: company.id, name: "Human Resources" });
    await expect(
      createDepartment({ companyId: company.id, name: "human resources" })
    ).rejects.toThrow('A department called "Human Resources" already exists.');
    const other = await createDepartment({ companyId: company.id, name: "Finance" });
    await expect(
      updateDepartment({ companyId: company.id, departmentId: other.id, name: "HUMAN RESOURCES" })
    ).rejects.toThrow(/already exists/);
    // Renaming a department to its own name (or its own name in other case) is fine.
    await expect(
      updateDepartment({ companyId: company.id, departmentId: other.id, name: "finance" })
    ).resolves.toMatchObject({ name: "finance" });
  });

  it("refuses to delete a department belonging to another company", async () => {
    const companyA = await makeCompany();
    const companyB = await makeCompany();
    const deptB = await makeDepartment(companyB.id, { code: "OTHER" });

    await expect(deleteDepartment(deptB.id, companyA.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      testPrisma.department.findUnique({ where: { id: deptB.id } })
    ).resolves.not.toBeNull();
  });

  it("allows archiving a department that still has positions (archive is safe by construction)", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id, { code: "ENG" });
    await testPrisma.position.create({
      data: {
        companyId: company.id,
        departmentId: dept.id,
        title: "CEO",
        positionCode: "POS-1",
        organizationalLevel: 1,
      },
    });
    const archived = await archiveDepartment(dept.id, company.id);
    expect(archived.status).toBe("INACTIVE");
    // The position's departmentId reference remains valid — nothing orphaned.
    const position = await testPrisma.position.findFirst({ where: { departmentId: dept.id } });
    expect(position).not.toBeNull();
  });

  it("reactivates an archived department", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id, { code: "ENG" });
    await archiveDepartment(dept.id, company.id);
    const reactivated = await reactivateDepartment(dept.id, company.id);
    expect(reactivated.status).toBe("ACTIVE");
  });

  describe("updateDepartment (Phase 4)", () => {
    it("updates name, description, and color without touching the parent", async () => {
      const company = await makeCompany();
      const parent = await makeDepartment(company.id, { code: "PARENT" });
      const dept = await makeDepartment(company.id, { code: "ENG", parentDepartmentId: parent.id });

      const updated = await updateDepartment({
        companyId: company.id,
        departmentId: dept.id,
        name: "Engineering (renamed)",
        description: "New description",
        color: "#16a34a",
      });

      expect(updated.name).toBe("Engineering (renamed)");
      expect(updated.description).toBe("New description");
      expect(updated.color).toBe("#16a34a");
      expect(updated.parentDepartmentId).toBe(parent.id);
    });

    it("normalizes an updated code to uppercase and rejects a duplicate", async () => {
      const company = await makeCompany();
      await makeDepartment(company.id, { code: "TAKEN" });
      const dept = await makeDepartment(company.id, { code: "ORIGINAL" });

      const renamed = await updateDepartment({
        companyId: company.id,
        departmentId: dept.id,
        code: "new-code",
      });
      expect(renamed.code).toBe("NEW-CODE");

      await expect(
        updateDepartment({ companyId: company.id, departmentId: dept.id, code: "taken" })
      ).rejects.toThrow(ConflictError);
    });

    it("rejects updating a department that does not exist in this company", async () => {
      const company = await makeCompany();
      const other = await makeCompany();
      const dept = await makeDepartment(other.id, { code: "ENG" });

      await expect(
        updateDepartment({ companyId: company.id, departmentId: dept.id, name: "Hijacked" })
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("searchDepartments (Phase 4)", () => {
    it("scopes results to the requesting company only", async () => {
      const company = await makeCompany();
      const other = await makeCompany();
      await makeDepartment(company.id, { code: "MINE" });
      await makeDepartment(other.id, { code: "THEIRS" });

      const result = await searchDepartments({ companyId: company.id, page: 1, pageSize: 20 });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.code).toBe("MINE");
      expect(result.totalCount).toBe(1);
    });

    it("filters by case-insensitive name/code search", async () => {
      const company = await makeCompany();
      await makeDepartment(company.id, { code: "ENG", name: "Engineering" });
      await makeDepartment(company.id, { code: "SALES", name: "Sales" });

      const byCode = await searchDepartments({
        companyId: company.id,
        search: "eng",
        page: 1,
        pageSize: 20,
      });
      expect(byCode.items.map((d) => d.code)).toEqual(["ENG"]);

      const byName = await searchDepartments({
        companyId: company.id,
        search: "sal",
        page: 1,
        pageSize: 20,
      });
      expect(byName.items.map((d) => d.code)).toEqual(["SALES"]);
    });

    it("filters by status", async () => {
      const company = await makeCompany();
      const active = await makeDepartment(company.id, { code: "ACTIVE1" });
      const toArchive = await makeDepartment(company.id, { code: "ARCHIVED1" });
      await archiveDepartment(toArchive.id, company.id);

      const result = await searchDepartments({
        companyId: company.id,
        status: "INACTIVE",
        page: 1,
        pageSize: 20,
      });
      expect(result.items.map((d) => d.id)).toEqual([toArchive.id]);
      expect(active).toBeTruthy();
    });

    it("paginates with a bounded page size", async () => {
      const company = await makeCompany();
      for (let i = 0; i < 5; i += 1) {
        await makeDepartment(company.id, { code: `DEPT-${i}`, name: `Dept ${i}` });
      }

      const page1 = await searchDepartments({ companyId: company.id, page: 1, pageSize: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.totalCount).toBe(5);

      const page3 = await searchDepartments({ companyId: company.id, page: 3, pageSize: 2 });
      expect(page3.items).toHaveLength(1);
    });
  });
});

describe("reorderDepartments (organogram drag-to-reorder, D33)", () => {
  it("saves the new left-to-right order, leaves unlisted departments alone, and audits only real changes", async () => {
    const company = await makeCompany();
    const a = await makeDepartment(company.id, { name: "A" });
    const b = await makeDepartment(company.id, { name: "B" });
    const c = await makeDepartment(company.id, { name: "C" });
    const untouched = await testPrisma.department.update({
      where: { id: (await makeDepartment(company.id, { name: "D" })).id },
      data: { displayOrder: 99 },
    });

    await reorderDepartments({ companyId: company.id, orderedDepartmentIds: [c.id, a.id, b.id] });

    const order = async (id: string) =>
      (await testPrisma.department.findUniqueOrThrow({ where: { id } })).displayOrder;
    expect(await order(c.id)).toBe(1);
    expect(await order(a.id)).toBe(2);
    expect(await order(b.id)).toBe(3);
    expect(await order(untouched.id)).toBe(99);

    // Same order again → nothing changes, nothing audited.
    const before = await testPrisma.auditEvent.count({ where: { companyId: company.id } });
    await reorderDepartments({ companyId: company.id, orderedDepartmentIds: [c.id, a.id, b.id] });
    expect(await testPrisma.auditEvent.count({ where: { companyId: company.id } })).toBe(before);
  });

  it("refuses (changing nothing) when a department belongs to another company", async () => {
    const company = await makeCompany();
    const other = await makeCompany();
    const a = await makeDepartment(company.id, { name: "A" });
    const foreign = await makeDepartment(other.id, { name: "X" });

    await expect(
      reorderDepartments({ companyId: company.id, orderedDepartmentIds: [foreign.id, a.id] })
    ).rejects.toThrow();
    expect(
      (await testPrisma.department.findUniqueOrThrow({ where: { id: a.id } })).displayOrder
    ).toBeNull();
  });
});
