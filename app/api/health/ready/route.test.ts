import { afterEach, describe, expect, it, vi } from "vitest";

const { queryRawMock, loggerErrorMock } = vi.hoisted(() => ({
  queryRawMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: { $queryRaw: queryRawMock } }));
vi.mock("@/lib/logger", () => ({ logger: { error: loggerErrorMock } }));

import { GET } from "./route";
import { EXPECTED_MIGRATIONS } from "@/lib/db/expected-migrations";

/** First call: SELECT 1. Second call: the applied migration names. */
function database(appliedNames: readonly string[]) {
  queryRawMock
    .mockResolvedValueOnce([{ "?column?": 1 }])
    .mockResolvedValueOnce(appliedNames.map((migration_name) => ({ migration_name })));
}

describe("GET /api/health/ready", () => {
  afterEach(() => vi.clearAllMocks());

  it("is ready (200) when every migration the code needs is applied", async () => {
    database(EXPECTED_MIGRATIONS);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      database: "reachable",
      schema: "ready",
      migrationsApplied: EXPECTED_MIGRATIONS.length,
      migrationsExpected: EXPECTED_MIGRATIONS.length,
    });
  });

  it("is NOT ready (503, pending) when the newest migration hasn't been applied — the staging incident", async () => {
    database(EXPECTED_MIGRATIONS.slice(0, -1));
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({
      status: "error",
      database: "reachable",
      schema: "pending",
      migrationsApplied: EXPECTED_MIGRATIONS.length - 1,
      migrationsPending: 1,
    });
    // Names go to the server log only, never the public response.
    expect(JSON.stringify(body)).not.toContain(EXPECTED_MIGRATIONS.at(-1)!);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      "readiness check failed",
      expect.objectContaining({ pendingMigrations: EXPECTED_MIGRATIONS.at(-1) })
    );
  });

  it("stays ready when the database has migrations newer than this code", async () => {
    database([...EXPECTED_MIGRATIONS, "20991231000000_future"]);
    expect((await GET()).status).toBe(200);
  });

  it("reports a never-migrated database as schema missing", async () => {
    database([]);
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "error",
      database: "reachable",
      schema: "missing",
    });
  });

  it("reports an unreachable database without leaking the error", async () => {
    queryRawMock.mockRejectedValueOnce(
      new Error("connect ECONNREFUSED 10.0.0.1:5432 password=hunter2")
    );
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ status: "error", database: "unreachable" });
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|hunter2|5432/);
  });
});
