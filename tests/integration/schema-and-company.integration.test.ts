import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

import { testPrisma } from "./setup";
import { makeCompany } from "./fixtures";

describe("schema and migration constraints", () => {
  it("applies to an empty database and creates every expected table", async () => {
    const tables = await testPrisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name != '_prisma_migrations'
    `;
    const names = tables.map((t) => t.table_name).sort();
    expect(names).toEqual([
      "accounts",
      "audit_events",
      "companies",
      "company_settings",
      "departments",
      "employees",
      "export_jobs",
      "import_jobs",
      "import_row_issues",
      "job_grades",
      "position_assignments",
      "positions",
      "sessions",
      "users",
      "verification_tokens",
    ]);
  });

  it("enforces unique company codes", async () => {
    await makeCompany({ code: "DUPCO" });
    await expect(makeCompany({ code: "DUPCO" })).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError
    );
  });

  it("enforces unique department codes within a company via the department service", async () => {
    const { createDepartment } = await import("@/lib/services/department.service");
    const company = await makeCompany();
    await createDepartment({ companyId: company.id, name: "Engineering", code: "ENG" });
    await expect(
      createDepartment({ companyId: company.id, name: "Engineering Duplicate", code: "eng" })
    ).rejects.toThrow(/already in use/);
  });

  it("enforces unique position codes within a company via the hierarchy service", async () => {
    const { createDepartment } = await import("@/lib/services/department.service");
    const { createPosition } = await import("@/lib/services/hierarchy.service");
    const company = await makeCompany();
    const dept = await createDepartment({ companyId: company.id, name: "Eng", code: "ENG" });
    await createPosition({
      companyId: company.id,
      departmentId: dept.id,
      title: "CEO",
      positionCode: "POS-1",
      primaryReportsToPositionId: null,
    });
    await expect(
      createPosition({
        companyId: company.id,
        departmentId: dept.id,
        title: "Someone Else",
        positionCode: "pos-1",
        primaryReportsToPositionId: null,
      })
    ).rejects.toThrow(/already in use/);
  });

  it("enforces unique employee codes within a company", async () => {
    const company = await makeCompany();
    await testPrisma.employee.create({
      data: { companyId: company.id, employeeCode: "E1", firstName: "A", lastName: "B" },
    });
    await expect(
      testPrisma.employee.create({
        data: { companyId: company.id, employeeCode: "E1", firstName: "C", lastName: "D" },
      })
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it("does NOT unsafely cascade-delete when a referenced row is removed (RESTRICT, not CASCADE)", async () => {
    const company = await makeCompany();
    const dept = await testPrisma.department.create({
      data: { companyId: company.id, code: "ENG", name: "Engineering" },
    });
    await testPrisma.position.create({
      data: {
        companyId: company.id,
        departmentId: dept.id,
        title: "CEO",
        positionCode: "POS-1",
        organizationalLevel: 1,
      },
    });

    await expect(testPrisma.department.delete({ where: { id: dept.id } })).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError
    );

    // The department must still exist — RESTRICT blocked the delete outright.
    const stillThere = await testPrisma.department.findUnique({ where: { id: dept.id } });
    expect(stillThere).not.toBeNull();
  });
});

describe("Company", () => {
  it("creates a valid company", async () => {
    const company = await makeCompany({ name: "Acme Testing Co" });
    expect(company.status).toBe("ACTIVE");
    expect(company.timezone).toBe("UTC");
  });

  it("rejects a duplicate company code", async () => {
    await makeCompany({ code: "ACME" });
    await expect(makeCompany({ code: "ACME" })).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError
    );
  });

  it("rejects a missing required value (name)", async () => {
    await expect(
      testPrisma.company.create({ data: { code: "NO-NAME" } as never })
    ).rejects.toThrow();
  });

  it("supports marking a company inactive without deleting it", async () => {
    const company = await makeCompany();
    const updated = await testPrisma.company.update({
      where: { id: company.id },
      data: { status: "INACTIVE" },
    });
    expect(updated.status).toBe("INACTIVE");
    expect(await testPrisma.company.findUnique({ where: { id: company.id } })).not.toBeNull();
  });
});
