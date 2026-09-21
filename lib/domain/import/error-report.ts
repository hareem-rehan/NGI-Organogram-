import { sanitizeForCsvOutput } from "./csv";
import type { RowIssue } from "./types";

/**
 * Builds the downloadable row-level error report (Step 13). Every value
 * is run through `sanitizeForCsvOutput` before being written, since these
 * are echoed values that may themselves have failed formula-injection
 * validation upstream — belt-and-suspenders protection for a file the
 * user will likely open directly in a spreadsheet application. Never
 * includes a raw database/ORM error — `safeMessage` is already a
 * pre-formatted, safe string by the time it reaches an `ImportRowIssue`.
 */
export function generateImportErrorReportCsv(issues: readonly RowIssue[]): string {
  const headers = ["rowNumber", "field", "severity", "code", "message"];
  const rows = issues.map((issue) => [
    String(issue.rowNumber),
    issue.field ?? "",
    issue.severity,
    issue.code,
    issue.safeMessage,
  ]);

  const lines = [headers, ...rows].map((row) =>
    row.map(sanitizeForCsvOutput).map(escapeCsvField).join(",")
  );
  return lines.join("\r\n") + "\r\n";
}

function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
