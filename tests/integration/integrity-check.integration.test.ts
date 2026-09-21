import { describe, expect, it } from "vitest";

import { runDomainIntegrityCheck } from "@/lib/services/integrity-check.service";
import { testPrisma } from "./setup";
import { makeCompany, makeDepartment, makeEmployee, makeRootPosition, makeUser } from "./fixtures";

/**
 * Phase 13 release hardening — Step 9's domain-integrity checker.
 *
 * Several of the 18 categories in lib/domain/integrity-check.ts are
 * ALREADY unreachable via any Prisma write because the schema itself
 * blocks them (self-reporting: `positions_no_self_report` CHECK;
 * multiple roots: `positions_one_root_per_company` partial unique
 * index; cross-company FK references: compound `[id, companyId]`
 * foreign keys throughout). Those are proven here as "the database
 * itself rejects this" rather than "the checker catches this after the
 * fact" — both are legitimate defense-in-depth evidence, but they are
 * different claims and this file is explicit about which is which.
 * Categories with NO such schema-level backstop are demonstrated by
 * actually inserting corrupt data (bypassing the service layer via
 * `testPrisma` directly, exactly the "a bad migration or direct SQL"
 * scenario this tool exists to catch) and confirming the checker flags
 * it.
 */
describe("Domain integrity check (Phase 13, Step 9)", () => {
  it("finds zero violations for a clean, well-formed company", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const root = await makeRootPosition(company.id, dept.id);
    await testPrisma.position.create({
      data: {
        companyId: company.id,
        departmentId: dept.id,
        positionCode: "CHILD-1",
        title: "Child",
        primaryReportsToPositionId: root.id,
        organizationalLevel: 2,
      },
    });
    await makeEmployee(company.id, { employeeCode: "EMP-1" });
    await makeUser(company.id, { role: "ADMIN" });

    const report = await runDomainIntegrityCheck(testPrisma);
    expect(report.violations).toEqual([]);
  });

  it("the database itself rejects a self-reporting position (schema-level defense-in-depth)", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const root = await makeRootPosition(company.id, dept.id);

    await expect(
      testPrisma.$executeRawUnsafe(
        `UPDATE "positions" SET "primaryReportsToPositionId" = $1::uuid WHERE "id" = $1::uuid`,
        root.id
      )
      // Prisma surfaces a hand-authored constraint by its column
      // list/detail, not its name (docs/DECISIONS.md A15's identical
      // finding for a different constraint) — assert on the DB's raw
      // error shape rather than a name that never appears.
    ).rejects.toThrow(/positions_no_self_report|check constraint/i);
  });

  it("the database itself rejects a second root position in the same company (schema-level defense-in-depth)", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    await makeRootPosition(company.id, dept.id);

    // Prisma reports a hand-authored partial unique index by its column
    // list ("companyId"), never its name (docs/DECISIONS.md A15's
    // identical finding) — assert on that shape instead.
    await expect(makeRootPosition(company.id, dept.id)).rejects.toThrow(
      /Unique constraint failed.*companyId/s
    );
  });

  it("flags case-insensitive duplicate position codes the database's case-sensitive unique constraint misses", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const root = await makeRootPosition(company.id, dept.id, { positionCode: "ENG-001" });
    // A different case of the same code, on a non-root position (only
    // one null-parent root is allowed per company, unrelated to the
    // code-duplicate check this test targets) — the DB's
    // @@unique([companyId, positionCode]) is case-sensitive, so this
    // insert succeeds even though it's a business-rule duplicate.
    await testPrisma.position.create({
      data: {
        companyId: company.id,
        departmentId: dept.id,
        positionCode: "eng-001",
        title: "Duplicate-by-case",
        primaryReportsToPositionId: root.id,
        organizationalLevel: 2,
      },
    });

    await expect(
      testPrisma.position.findMany({ where: { companyId: company.id } })
    ).resolves.toHaveLength(2);

    const report = await runDomainIntegrityCheck(testPrisma);
    expect(report.violations.map((v) => v.category)).toContain("DUPLICATE_POSITION_CODE");
  });

  it("flags case-insensitive duplicate employee codes the database's case-sensitive unique constraint misses", async () => {
    const company = await makeCompany();
    await makeEmployee(company.id, { employeeCode: "EMP-100", workEmail: "a@example.test" });
    await testPrisma.employee.create({
      data: {
        companyId: company.id,
        employeeCode: "emp-100",
        firstName: "Duplicate",
        lastName: "ByCase",
        workEmail: "b@example.test",
      },
    });

    const report = await runDomainIntegrityCheck(testPrisma);
    expect(report.violations.map((v) => v.category)).toContain("DUPLICATE_EMPLOYEE_CODE");
  });

  it("flags two overlapping primary assignments to the same position when both have a closed (non-null) endDate — outside the DB's open-ended-only partial unique index", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const position = await makeRootPosition(company.id, dept.id);
    const employeeA = await makeEmployee(company.id, { employeeCode: "EMP-A" });
    const employeeB = await makeEmployee(company.id, { employeeCode: "EMP-B" });

    await testPrisma.positionAssignment.create({
      data: {
        companyId: company.id,
        employeeId: employeeA.id,
        positionId: position.id,
        isPrimary: true,
        startDate: new Date("2024-01-01"),
        endDate: new Date("2024-12-01"),
      },
    });
    // Overlaps the first assignment's range (2024-06-01 is before
    // 2024-12-01) — the DB's partial unique index only restricts rows
    // with endDate IS NULL, so this insert succeeds.
    await testPrisma.positionAssignment.create({
      data: {
        companyId: company.id,
        employeeId: employeeB.id,
        positionId: position.id,
        isPrimary: true,
        startDate: new Date("2024-06-01"),
        endDate: new Date("2025-01-01"),
      },
    });

    const report = await runDomainIntegrityCheck(testPrisma);
    expect(report.violations.map((v) => v.category)).toContain("OVERLAPPING_POSITION_ASSIGNMENT");
  });

  // Reversed on 2026-09-14. This test's previous name asserted the
  // business rule "rejects" a zero-duration assignment, which contradicted
  // what the application actually does on every write. The stakeholder
  // confirmed same-day is legal (docs/DECISIONS.md), so the check now
  // flags only a genuinely inverted range — endDate BEFORE startDate.
  it("does not flag a same-day assignment — the schema permits it and the app creates them", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const position = await makeRootPosition(company.id, dept.id);
    const employee = await makeEmployee(company.id);

    // Same-day: legal, and the app creates these itself.
    const sameDay = await testPrisma.positionAssignment.create({
      data: {
        companyId: company.id,
        employeeId: employee.id,
        positionId: position.id,
        isPrimary: true,
        startDate: new Date("2024-01-01"),
        endDate: new Date("2024-01-01"),
      },
    });

    expect(sameDay.endDate).toEqual(sameDay.startDate);

    const report = await runDomainIntegrityCheck(testPrisma);
    expect(report.violations.map((v) => v.category)).not.toContain("INVALID_ASSIGNMENT_DATE_RANGE");

    // The genuinely-inverted case (endDate BEFORE startDate) is NOT
    // exercised here, because it cannot be created: the schema's own
    // `position_assignments_end_after_start` CHECK is `endDate >=
    // startDate`, so Postgres rejects the row outright. That constraint is
    // also the clearest evidence the same-day case above is intended
    // rather than tolerated — the database, the write-path validator, and
    // overlap detection all permit it, and only this integrity check ever
    // disagreed. The inverted case stays covered by the pure unit test in
    // lib/domain/integrity-check.test.ts, which needs no database and so
    // can construct a row the database would refuse.
  });

  it("flags a company with users but no ACTIVE ADMIN", async () => {
    const company = await makeCompany();
    await makeUser(company.id, { role: "VIEWER" });

    const report = await runDomainIntegrityCheck(testPrisma);
    expect(report.violations.map((v) => v.category)).toContain("COMPANY_WITHOUT_ACTIVE_ADMIN");
  });

  it("flags a Session row still present for a DISABLED user (should have been revoked)", async () => {
    const company = await makeCompany();
    await makeUser(company.id, { role: "ADMIN" }); // keep the company otherwise valid
    const disabledUser = await testPrisma.user.create({
      data: {
        companyId: company.id,
        email: "disabled-with-session@example.test",
        role: "VIEWER",
        status: "DISABLED",
      },
    });
    await testPrisma.session.create({
      data: {
        sessionToken: "leftover-session-token",
        userId: disabledUser.id,
        expires: new Date(Date.now() + 86_400_000),
      },
    });

    const report = await runDomainIntegrityCheck(testPrisma);
    expect(report.violations.map((v) => v.category)).toContain("DISABLED_USER_WITH_ACTIVE_SESSION");
  });

  it("flags an audit event whose actor belongs to a different company than the event itself (AuditEvent.actor's FK is not company-compound, unlike every other relation in this schema)", async () => {
    const companyA = await makeCompany();
    const companyB = await makeCompany();
    await makeUser(companyA.id, { role: "ADMIN" });
    const actorInCompanyB = await makeUser(companyB.id, { role: "ADMIN" });

    await testPrisma.auditEvent.create({
      data: {
        companyId: companyA.id,
        actorUserId: actorInCompanyB.id,
        actorType: "USER",
        action: "CREATED",
        category: "DEPARTMENT",
        entityType: "Department",
      },
    });

    const report = await runDomainIntegrityCheck(testPrisma);
    expect(report.violations.map((v) => v.category)).toContain(
      "AUDIT_EVENT_ACTOR_COMPANY_MISMATCH"
    );
  });
});
