import { describe, expect, it } from "vitest";

import { runtimeDatabaseUrl } from "./runtime-database-url";

const SESSION =
  "postgresql://postgres.ref:s3cr%40t@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres";

describe("runtimeDatabaseUrl", () => {
  it("moves a Supabase session-pooler URL to the transaction pooler with pgbouncer settings", () => {
    const { url, rewritten } = runtimeDatabaseUrl(SESSION);
    expect(rewritten).toBe(true);
    const parsed = new URL(url!);
    expect(parsed.port).toBe("6543");
    expect(parsed.searchParams.get("pgbouncer")).toBe("true");
    expect(parsed.searchParams.get("connection_limit")).toBe("1");
    // Credentials, host and database are kept exactly.
    expect(parsed.username).toBe("postgres.ref");
    expect(parsed.password).toBe("s3cr%40t");
    expect(parsed.hostname).toBe("aws-0-ap-southeast-2.pooler.supabase.com");
    expect(parsed.pathname).toBe("/postgres");
  });

  it("leaves an already-correct transaction-pooler URL untouched, including its own limit", () => {
    const ok =
      "postgresql://postgres.ref:pw@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5";
    expect(runtimeDatabaseUrl(ok)).toEqual({ url: ok, rewritten: false });
  });

  it("adds only what is missing on the transaction port", () => {
    const { url, rewritten } = runtimeDatabaseUrl(
      "postgresql://u:p@aws-0-x.pooler.supabase.com:6543/postgres?connection_limit=3"
    );
    expect(rewritten).toBe(true);
    const parsed = new URL(url!);
    expect(parsed.searchParams.get("pgbouncer")).toBe("true");
    expect(parsed.searchParams.get("connection_limit")).toBe("3");
  });

  it.each([
    ["the local Docker database", "postgresql://organogram:pw@localhost:5432/organogram_dev"],
    ["a direct Supabase connection", "postgresql://postgres:pw@db.ref.supabase.co:5432/postgres"],
    ["a malformed value", "not a url"],
  ])("leaves %s alone", (_label, raw) => {
    expect(runtimeDatabaseUrl(raw)).toEqual({ url: raw, rewritten: false });
  });

  it("passes an unset value through (Prisma then reports it)", () => {
    expect(runtimeDatabaseUrl(undefined)).toEqual({ url: undefined, rewritten: false });
  });
});
