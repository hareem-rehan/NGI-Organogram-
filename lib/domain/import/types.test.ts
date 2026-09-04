import { describe, expect, it } from "vitest";

import { checkColumns, findDenylistedColumns, resolveFieldForWrite } from "./types";

describe("findDenylistedColumns", () => {
  it("flags organizationalLevel, vacancy, role, salary among headers", () => {
    expect(
      findDenylistedColumns(["positionCode", "organizationalLevel", "title", "salary"])
    ).toEqual(["organizationalLevel", "salary"]);
  });

  it("returns an empty array when nothing is denylisted", () => {
    expect(findDenylistedColumns(["positionCode", "title"])).toEqual([]);
  });
});

describe("checkColumns", () => {
  it("returns no issues when every header is allowed", () => {
    expect(checkColumns(["code", "name"], ["code", "name", "description"])).toEqual([]);
  });

  it("flags a denylisted column as a blocking file-level ERROR", () => {
    const issues = checkColumns(["code", "organizationalLevel"], ["code"]);
    expect(issues).toEqual([
      expect.objectContaining({ rowNumber: 0, severity: "ERROR", field: "organizationalLevel" }),
    ]);
  });

  it("flags an unrecognized (but not denylisted) column as a non-blocking WARNING", () => {
    const issues = checkColumns(["code", "someRandomColumn"], ["code"]);
    expect(issues).toEqual([
      expect.objectContaining({ rowNumber: 0, severity: "WARNING", field: "someRandomColumn" }),
    ]);
  });

  it("never double-reports a denylisted column as also unrecognized", () => {
    const issues = checkColumns(["organizationalLevel"], []);
    expect(issues).toHaveLength(1);
  });
});

describe("resolveFieldForWrite", () => {
  it('"value" always wins regardless of current value', () => {
    expect(resolveFieldForWrite({ kind: "value", value: "new" }, "old")).toBe("new");
    expect(resolveFieldForWrite({ kind: "value", value: "new" }, null)).toBe("new");
  });

  it('"clear" always resolves to null', () => {
    expect(resolveFieldForWrite({ kind: "clear" }, "old")).toBeNull();
  });

  it('"keep" preserves the current value on UPDATE', () => {
    expect(resolveFieldForWrite({ kind: "keep" }, "old")).toBe("old");
  });

  it('"keep" degrades to null when there is no current value (a CREATE row)', () => {
    expect(resolveFieldForWrite({ kind: "keep" }, null)).toBeNull();
  });
});
