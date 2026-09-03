import { describe, expect, it } from "vitest";

import { createDepartment } from "@/lib/services/department.service";
import { testPrisma } from "./setup";

describe("integration harness smoke test", () => {
  it("can reach the real test database and run a service function end to end", async () => {
    const company = await testPrisma.company.create({
      data: { code: "SMOKE-CO", name: "Smoke Test Co" },
    });

    const department = await createDepartment({
      companyId: company.id,
      name: "Smoke Department",
      code: "smoke-dept",
    });

    expect(department.code).toBe("SMOKE-DEPT");
    expect(department.companyId).toBe(company.id);
  });
});
