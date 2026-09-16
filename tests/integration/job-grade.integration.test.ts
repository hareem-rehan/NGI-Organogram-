import { describe, expect, it } from "vitest";

import { ensureJobGradeByCode, normalizeGradeCode } from "@/lib/services/job-grade.service";
import { DomainValidationError } from "@/lib/domain/errors";
import { testPrisma } from "./setup";
import { makeCompany } from "./fixtures";

describe("ensureJobGradeByCode", () => {
  it("creates a grade from the standard scale on first use, with the scale's name and rank", async () => {
    const company = await makeCompany();

    const grade = await ensureJobGradeByCode(company.id, "L7", testPrisma);

    expect(grade.code).toBe("L7");
    expect(grade.name).toBe("Lead / Principal");
    expect(grade.displayOrder).toBe(7);
    expect(await testPrisma.jobGrade.count({ where: { companyId: company.id } })).toBe(1);
  });

  it("returns the existing grade on the second call — never a duplicate", async () => {
    const company = await makeCompany();

    const first = await ensureJobGradeByCode(company.id, "L10", testPrisma);
    const second = await ensureJobGradeByCode(company.id, "L10", testPrisma);

    expect(second.id).toBe(first.id);
    expect(await testPrisma.jobGrade.count({ where: { companyId: company.id } })).toBe(1);
  });

  it("normalizes case and whitespace, so 'l7' and ' L7 ' resolve to the same grade", async () => {
    const company = await makeCompany();

    const a = await ensureJobGradeByCode(company.id, "l7", testPrisma);
    const b = await ensureJobGradeByCode(company.id, " L7 ", testPrisma);

    expect(normalizeGradeCode(" l7 ")).toBe("L7");
    expect(b.id).toBe(a.id);
  });

  it("rejects a code that is not on the scale, rather than creating junk", async () => {
    const company = await makeCompany();

    await expect(ensureJobGradeByCode(company.id, "PLATINUM", testPrisma)).rejects.toBeInstanceOf(
      DomainValidationError
    );
    expect(await testPrisma.jobGrade.count({ where: { companyId: company.id } })).toBe(0);
  });

  it("keeps grades per-company — the same code in two companies is two separate rows", async () => {
    const companyA = await makeCompany();
    const companyB = await makeCompany();

    const a = await ensureJobGradeByCode(companyA.id, "L7", testPrisma);
    const b = await ensureJobGradeByCode(companyB.id, "L7", testPrisma);

    expect(a.id).not.toBe(b.id);
  });
});
