import { describe, expect, it } from "vitest";

import { generateImportErrorReportCsv } from "./error-report";
import { parseCsvFile } from "./csv";
import type { RowIssue } from "./types";

describe("generateImportErrorReportCsv", () => {
  it("produces a header row plus one row per issue, itself re-parsable", () => {
    const issues: RowIssue[] = [
      {
        rowNumber: 1,
        field: "departmentCode",
        severity: "ERROR",
        code: "REQUIRED_FIELD",
        safeMessage: "departmentCode is required.",
      },
      {
        rowNumber: 2,
        field: "departmentName",
        severity: "WARNING",
        code: "SOME_WARNING",
        safeMessage: "A minor issue.",
      },
    ];
    const csv = generateImportErrorReportCsv(issues);
    const parsed = parseCsvFile(csv, ["rowNumber", "field", "severity", "code", "message"]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]!.values.code).toBe("REQUIRED_FIELD");
  });

  it("sanitizes a formula-injection-shaped message so it cannot execute if opened in a spreadsheet", () => {
    const issues: RowIssue[] = [
      {
        rowNumber: 1,
        field: "name",
        severity: "ERROR",
        code: "INVALID_FORMAT",
        safeMessage: "=cmd|'/c calc'!A1",
      },
    ];
    const csv = generateImportErrorReportCsv(issues);
    // The sanitized value must carry a leading safe-quote prefix, so a
    // spreadsheet renders it as literal text rather than evaluating it
    // as a formula.
    expect(csv).toMatch(/'=cmd/);
  });

  it("renders an empty report (zero issues) as just a header row", () => {
    const csv = generateImportErrorReportCsv([]);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("rowNumber,field,severity,code,message");
  });

  it("renders a file-level issue (rowNumber 0, no field) with an empty field cell, not a crash", () => {
    const issues: RowIssue[] = [
      {
        rowNumber: 0,
        field: null,
        severity: "ERROR",
        code: "UNSUPPORTED_COLUMN",
        safeMessage: "Column x cannot be imported.",
      },
    ];
    const csv = generateImportErrorReportCsv(issues);
    expect(csv).toContain("0,,ERROR,UNSUPPORTED_COLUMN");
  });
});
