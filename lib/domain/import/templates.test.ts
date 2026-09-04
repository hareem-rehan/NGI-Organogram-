import { describe, expect, it } from "vitest";

import { generateImportTemplateCsv } from "./templates";
import { parseCsvFile } from "./csv";
import { DEPARTMENT_REQUIRED_COLUMNS } from "./department-import";
import { POSITION_REQUIRED_COLUMNS } from "./position-import";
import { EMPLOYEE_REQUIRED_COLUMNS } from "./employee-import";
import { ASSIGNMENT_REQUIRED_COLUMNS } from "./assignment-import";

describe("generateImportTemplateCsv", () => {
  it("produces a DEPARTMENT template that itself parses cleanly and contains every required column", () => {
    const { content } = generateImportTemplateCsv("DEPARTMENT");
    const parsed = parseCsvFile(content, DEPARTMENT_REQUIRED_COLUMNS);
    expect(parsed.rows).toHaveLength(1);
  });

  it("produces a POSITION template that itself parses cleanly", () => {
    const { content } = generateImportTemplateCsv("POSITION");
    expect(() => parseCsvFile(content, POSITION_REQUIRED_COLUMNS)).not.toThrow();
  });

  it("produces an EMPLOYEE template that itself parses cleanly", () => {
    const { content } = generateImportTemplateCsv("EMPLOYEE");
    expect(() => parseCsvFile(content, EMPLOYEE_REQUIRED_COLUMNS)).not.toThrow();
  });

  it("produces an ASSIGNMENT template that itself parses cleanly", () => {
    const { content } = generateImportTemplateCsv("ASSIGNMENT");
    expect(() => parseCsvFile(content, ASSIGNMENT_REQUIRED_COLUMNS)).not.toThrow();
  });

  it("gives each import type a distinct, safe filename", () => {
    const filenames = (["DEPARTMENT", "POSITION", "EMPLOYEE", "ASSIGNMENT"] as const).map(
      (t) => generateImportTemplateCsv(t).filename
    );
    expect(new Set(filenames).size).toBe(4);
    for (const name of filenames) {
      expect(name).toMatch(/^[a-z0-9-]+\.csv$/);
    }
  });

  it("never contains a formula-injection-triggering example value", () => {
    for (const type of ["DEPARTMENT", "POSITION", "EMPLOYEE", "ASSIGNMENT"] as const) {
      const { content } = generateImportTemplateCsv(type);
      expect(content).not.toMatch(/,[=+@-]/);
    }
  });
});
