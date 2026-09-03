import { describe, expect, it } from "vitest";

import {
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
