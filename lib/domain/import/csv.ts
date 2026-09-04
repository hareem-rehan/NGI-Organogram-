import Papa from "papaparse";

/**
 * Pure CSV parsing/normalization shared by every import type
 * (docs/CSV_IMPORT_GUIDE.md). No Prisma import here on purpose — this is
 * the "Stage 1: file validation" layer from the Phase 10 prompt, and it
 * must be exercisable with in-memory fixtures.
 */

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_DATA_ROWS = 5000;
/** Defensive ceiling per cell — well above any real column's own max length. */
export const MAX_FIELD_LENGTH = 1000;
/** Defensive ceiling on column count — every real template has well under this. */
export const MAX_COLUMN_COUNT = 30;

export const CLEAR_SENTINEL = "__CLEAR__";
export const NONE_SENTINEL = "__NONE__";
export const ROOT_SENTINEL = "__ROOT__";

export class CsvFileError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "CsvFileError";
  }
}

export interface ParsedCsvRow {
  /** 1-indexed data-row number, NOT counting the header row. */
  rowNumber: number;
  values: Record<string, string>;
}

export interface ParsedCsvFile {
  headers: string[];
  rows: ParsedCsvRow[];
}

/** Strips a leading UTF-8 BOM, if present, then decodes as UTF-8 text. */
export function decodeCsvBuffer(buffer: Buffer): string {
  let text = buffer.toString("utf-8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

/**
 * Parses raw CSV text into a header list and a deterministically-numbered
 * row list, enforcing file-level limits (Stage 1). Never evaluates
 * formulas or interprets HTML — every cell is treated as an opaque
 * string. Throws `CsvFileError` for a file-level defect (empty file,
 * header-only file, duplicate/missing headers, oversized file/rows/
 * fields) rather than returning a row-level issue, since none of these
 * can be attributed to one row.
 */
export function parseCsvFile(rawText: string, requiredHeaders: readonly string[]): ParsedCsvFile {
  if (rawText.trim().length === 0) {
    throw new CsvFileError("The file is empty — it has no header row.", "EMPTY_FILE");
  }

  // Parsed with `header: false` deliberately — Papa's own `header: true`
  // mode silently renames duplicate/empty header cells (e.g. two "code"
  // columns become "code"/"code_1") rather than surfacing them, which
  // would hide exactly the DUPLICATE_HEADERS/MISSING_HEADERS defects this
  // function needs to catch. Raw rows are mapped to header names by hand
  // below, after checking the header row ourselves.
  const result = Papa.parse<string[]>(rawText, {
    header: false,
    delimiter: ",",
    skipEmptyLines: "greedy",
  });

  const [rawHeaderRow, ...dataRows] = result.data;
  const headers = (rawHeaderRow ?? []).map((h) => h.trim());

  if (headers.length === 0 || headers.every((h) => h.length === 0)) {
    throw new CsvFileError(
      "The file has a header row but no recognizable column names.",
      "MISSING_HEADERS"
    );
  }

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const header of headers) {
    if (header.length === 0) continue;
    if (seen.has(header)) duplicates.add(header);
    seen.add(header);
  }
  if (duplicates.size > 0) {
    throw new CsvFileError(
      `Duplicate column header(s): ${[...duplicates].join(", ")}.`,
      "DUPLICATE_HEADERS"
    );
  }

  const missingRequired = requiredHeaders.filter((h) => !headers.includes(h));
  if (missingRequired.length > 0) {
    throw new CsvFileError(
      `Missing required column(s): ${missingRequired.join(", ")}.`,
      "MISSING_REQUIRED_HEADERS"
    );
  }

  if (headers.length > MAX_COLUMN_COUNT) {
    throw new CsvFileError(
      `The file has ${headers.length} columns, exceeding the maximum of ${MAX_COLUMN_COUNT}.`,
      "TOO_MANY_COLUMNS"
    );
  }

  if (dataRows.length === 0) {
    throw new CsvFileError("The file has a header row but no data rows.", "HEADER_ONLY_FILE");
  }

  if (dataRows.length > MAX_DATA_ROWS) {
    throw new CsvFileError(
      `The file has ${dataRows.length} data rows, exceeding the maximum of ${MAX_DATA_ROWS}.`,
      "TOO_MANY_ROWS"
    );
  }

  const rows: ParsedCsvRow[] = dataRows.map((rawRow, index) => {
    const values: Record<string, string> = {};
    headers.forEach((header, columnIndex) => {
      if (header.length === 0) return;
      const raw = rawRow[columnIndex];
      const value = raw === undefined || raw === null ? "" : String(raw);
      if (value.length > MAX_FIELD_LENGTH) {
        throw new CsvFileError(
          `Row ${index + 1}: the value in column "${header}" is too long (${value.length} characters, maximum ${MAX_FIELD_LENGTH}).`,
          "FIELD_TOO_LONG"
        );
      }
      values[header] = value;
    });
    return { rowNumber: index + 1, values };
  });

  return { headers: headers.filter((h) => h.length > 0), rows };
}

/**
 * A value beginning with `=`, `+`, `-`, `@`, or a control character is a
 * classic CSV-formula-injection trigger in spreadsheet applications. This
 * app never evaluates cell content itself (papaparse only ever produces
 * plain strings), but a value with this shape must never be accepted as
 * legitimate business data and must never be echoed back into a
 * downloadable report without sanitization (see `sanitizeForCsvOutput`).
 */
const FORMULA_TRIGGER_PATTERN = /^[=+\-@\t\r]/;

export function isFormulaInjectionRisk(rawValue: string): boolean {
  return FORMULA_TRIGGER_PATTERN.test(rawValue);
}

/**
 * Neutralizes formula-injection risk in a value written into a
 * downloadable CSV (the error report) by prefixing a leading single quote
 * — the standard mitigation most spreadsheet applications respect,
 * forcing the cell to render as literal text rather than a formula.
 */
export function sanitizeForCsvOutput(value: string): string {
  return isFormulaInjectionRisk(value) ? `'${value}` : value;
}

export type FieldIntent =
  | { kind: "blank" }
  | { kind: "clear" }
  | { kind: "none" }
  | { kind: "root" }
  | { kind: "value"; value: string };

/**
 * Classifies a raw cell value's intent before entity-specific validation
 * runs. Each entity module decides which `kind`s a given column actually
 * accepts — a sentinel appearing on a column that doesn't support it is
 * an entity-specific validation error, not silently treated as a literal
 * string (`__ROOT__` could otherwise pass a generic code-format check).
 */
export function interpretFieldValue(raw: string): FieldIntent {
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "blank" };
  if (trimmed === CLEAR_SENTINEL) return { kind: "clear" };
  if (trimmed === NONE_SENTINEL) return { kind: "none" };
  if (trimmed === ROOT_SENTINEL) return { kind: "root" };
  return { kind: "value", value: trimmed };
}
