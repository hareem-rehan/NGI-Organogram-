import { describe, expect, it } from "vitest";

import {
  CsvFileError,
  decodeCsvBuffer,
  interpretFieldValue,
  isFormulaInjectionRisk,
  MAX_COLUMN_COUNT,
  MAX_DATA_ROWS,
  MAX_FIELD_LENGTH,
  parseCsvFile,
  sanitizeForCsvOutput,
} from "./csv";

const REQUIRED = ["code", "name"] as const;

describe("decodeCsvBuffer", () => {
  it("decodes plain UTF-8 content", () => {
    expect(decodeCsvBuffer(Buffer.from("code,name\nA,Alpha\n", "utf-8"))).toBe(
      "code,name\nA,Alpha\n"
    );
  });

  it("strips a leading UTF-8 BOM", () => {
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("code,name\n")]);
    expect(decodeCsvBuffer(withBom)).toBe("code,name\n");
  });
});

describe("parseCsvFile", () => {
  it("parses a valid file with quoted commas and escaped quotes", () => {
    const csv = 'code,name\nA,"Alpha, Inc."\nB,"She said ""hi"""\n';
    const result = parseCsvFile(csv, REQUIRED);
    expect(result.headers).toEqual(["code", "name"]);
    expect(result.rows).toEqual([
      { rowNumber: 1, values: { code: "A", name: "Alpha, Inc." } },
      { rowNumber: 2, values: { code: "B", name: 'She said "hi"' } },
    ]);
  });

  it("handles Windows (CRLF) line endings", () => {
    const csv = "code,name\r\nA,Alpha\r\nB,Beta\r\n";
    const result = parseCsvFile(csv, REQUIRED);
    expect(result.rows).toHaveLength(2);
  });

  it("assigns deterministic 1-indexed row numbers not counting the header", () => {
    const csv = "code,name\nA,Alpha\nB,Beta\nC,Gamma\n";
    const result = parseCsvFile(csv, REQUIRED);
    expect(result.rows.map((r) => r.rowNumber)).toEqual([1, 2, 3]);
  });

  it("skips blank lines without treating them as data rows", () => {
    const csv = "code,name\nA,Alpha\n\nB,Beta\n";
    const result = parseCsvFile(csv, REQUIRED);
    expect(result.rows).toHaveLength(2);
  });

  it("tolerates a trailing newline", () => {
    const csv = "code,name\nA,Alpha\n";
    expect(() => parseCsvFile(csv, REQUIRED)).not.toThrow();
  });

  it("trims header whitespace", () => {
    const csv = " code , name \nA,Alpha\n";
    const result = parseCsvFile(csv, REQUIRED);
    expect(result.headers).toEqual(["code", "name"]);
  });

  it("throws EMPTY_FILE for a completely empty file", () => {
    expect(() => parseCsvFile("", REQUIRED)).toThrow(CsvFileError);
    try {
      parseCsvFile("   \n  ", REQUIRED);
      expect.fail("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(CsvFileError);
      expect((error as CsvFileError).code).toBe("EMPTY_FILE");
    }
  });

  it("throws HEADER_ONLY_FILE for a file with only a header row", () => {
    try {
      parseCsvFile("code,name\n", REQUIRED);
      expect.fail("should have thrown");
    } catch (error) {
      expect((error as CsvFileError).code).toBe("HEADER_ONLY_FILE");
    }
  });

  it("throws MISSING_REQUIRED_HEADERS when a required column is absent", () => {
    try {
      parseCsvFile("code\nA\n", REQUIRED);
      expect.fail("should have thrown");
    } catch (error) {
      expect((error as CsvFileError).code).toBe("MISSING_REQUIRED_HEADERS");
      expect((error as CsvFileError).message).toContain("name");
    }
  });

  it("throws DUPLICATE_HEADERS when the same column name appears twice", () => {
    try {
      parseCsvFile("code,name,code\nA,Alpha,B\n", REQUIRED);
      expect.fail("should have thrown");
    } catch (error) {
      expect((error as CsvFileError).code).toBe("DUPLICATE_HEADERS");
    }
  });

  it("rejects a comma-only header row — papaparse's blank-line skipping treats it as empty, so the next real line becomes the header and required columns are reported missing", () => {
    // (A file whose ENTIRE header row is literally empty is unreachable
    // through papaparse's own "greedy" blank-line handling, which treats
    // an all-empty/all-comma line as blank before this function ever sees
    // it as a row — this still safely rejects the file, just via
    // MISSING_REQUIRED_HEADERS rather than a distinct "empty header" code.)
    try {
      parseCsvFile(",,\nA,B,C\n", REQUIRED);
      expect.fail("should have thrown");
    } catch (error) {
      expect((error as CsvFileError).code).toBe("MISSING_REQUIRED_HEADERS");
    }
  });

  it("treats a semicolon-delimited file as having no recognizable comma-separated headers (wrong delimiter)", () => {
    try {
      parseCsvFile("code;name\nA;Alpha\n", REQUIRED);
      expect.fail("should have thrown");
    } catch (error) {
      expect((error as CsvFileError).code).toBe("MISSING_REQUIRED_HEADERS");
    }
  });

  it("throws TOO_MANY_COLUMNS past the defensive column-count ceiling", () => {
    const headers = Array.from({ length: MAX_COLUMN_COUNT + 1 }, (_, i) => `col${i}`);
    const csv = `${headers.join(",")}\n${headers.map(() => "x").join(",")}\n`;
    try {
      parseCsvFile(csv, []);
      expect.fail("should have thrown");
    } catch (error) {
      expect((error as CsvFileError).code).toBe("TOO_MANY_COLUMNS");
    }
  });

  it("throws TOO_MANY_ROWS past the maximum data-row limit", () => {
    const lines = Array.from({ length: MAX_DATA_ROWS + 1 }, (_, i) => `C${i},N${i}`);
    const csv = `code,name\n${lines.join("\n")}\n`;
    try {
      parseCsvFile(csv, REQUIRED);
      expect.fail("should have thrown");
    } catch (error) {
      expect((error as CsvFileError).code).toBe("TOO_MANY_ROWS");
    }
  });

  it("throws FIELD_TOO_LONG for an excessively long field value", () => {
    const longValue = "x".repeat(MAX_FIELD_LENGTH + 1);
    const csv = `code,name\nA,${longValue}\n`;
    try {
      parseCsvFile(csv, REQUIRED);
      expect.fail("should have thrown");
    } catch (error) {
      expect((error as CsvFileError).code).toBe("FIELD_TOO_LONG");
    }
  });

  it("fills a missing trailing cell with an empty string rather than undefined", () => {
    const csv = "code,name\nA\n";
    const result = parseCsvFile(csv, REQUIRED);
    expect(result.rows[0]!.values.name).toBe("");
  });
});

describe("isFormulaInjectionRisk / sanitizeForCsvOutput", () => {
  it.each(["=SUM(A1:A2)", "+1+1", "-1+1", "@SUM(1)", "\ttab-prefixed"])(
    "flags %j as a formula-injection risk",
    (value) => {
      expect(isFormulaInjectionRisk(value)).toBe(true);
    }
  );

  it.each(["Engineering", "ENG-001", "A normal description", "hyphenated-word (not a formula)"])(
    "does not flag %j",
    (value) => {
      expect(isFormulaInjectionRisk(value)).toBe(false);
    }
  );

  it("prefixes a risky value with a single quote so spreadsheets treat it as literal text", () => {
    expect(sanitizeForCsvOutput("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1");
  });

  it("leaves a safe value unchanged", () => {
    expect(sanitizeForCsvOutput("Engineering")).toBe("Engineering");
  });
});

describe("interpretFieldValue", () => {
  it("classifies an empty/whitespace-only value as blank", () => {
    expect(interpretFieldValue("")).toEqual({ kind: "blank" });
    expect(interpretFieldValue("   ")).toEqual({ kind: "blank" });
  });

  it("classifies the clear sentinel", () => {
    expect(interpretFieldValue("__CLEAR__")).toEqual({ kind: "clear" });
  });

  it("classifies the none sentinel", () => {
    expect(interpretFieldValue("__NONE__")).toEqual({ kind: "none" });
  });

  it("classifies the root sentinel", () => {
    expect(interpretFieldValue("__ROOT__")).toEqual({ kind: "root" });
  });

  it("classifies an ordinary value, trimmed", () => {
    expect(interpretFieldValue("  Engineering  ")).toEqual({ kind: "value", value: "Engineering" });
  });

  it("treats a sentinel-like value with different casing as an ordinary literal value, not a sentinel", () => {
    expect(interpretFieldValue("__clear__")).toEqual({ kind: "value", value: "__clear__" });
  });
});
