import { describe, expect, it } from "vitest";

import { assertSafeTestDatabaseUrl, UnsafeTestDatabaseError } from "./test-guard";

describe("assertSafeTestDatabaseUrl", () => {
  it("accepts a URL whose database name contains 'test'", () => {
    expect(() =>
      assertSafeTestDatabaseUrl("postgresql://user:pass@localhost:5433/organogram_test")
    ).not.toThrow();
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => assertSafeTestDatabaseUrl(undefined)).toThrow(UnsafeTestDatabaseError);
  });

  it("rejects an unparsable URL", () => {
    expect(() => assertSafeTestDatabaseUrl("not-a-url")).toThrow(UnsafeTestDatabaseError);
  });

  it("rejects a database name that does not contain 'test'", () => {
    expect(() =>
      assertSafeTestDatabaseUrl("postgresql://user:pass@localhost:5433/organogram_dev")
    ).toThrow(UnsafeTestDatabaseError);
  });

  it("rejects a database name that looks production-related even if it mentions test", () => {
    expect(() =>
      assertSafeTestDatabaseUrl("postgresql://user:pass@localhost:5433/production_test")
    ).toThrow(UnsafeTestDatabaseError);
  });

  it("rejects a production-looking hostname regardless of database name", () => {
    expect(() =>
      assertSafeTestDatabaseUrl("postgresql://user:pass@prod-db.internal:5432/organogram_test")
    ).toThrow(UnsafeTestDatabaseError);
  });
});
