import { afterEach, describe, expect, it, vi } from "vitest";

// vi.mock(...) calls are hoisted above imports/other top-level code, so
// the mock functions they reference must be created via vi.hoisted() —
// a plain top-level `const` here would be a temporal-dead-zone error.
const { buildHealthPayloadMock, loggerErrorMock } = vi.hoisted(() => ({
  buildHealthPayloadMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock("@/lib/health", () => ({
  buildHealthPayload: buildHealthPayloadMock,
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: loggerErrorMock, info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { GET } from "./route";

describe("GET /api/health", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with the health payload and a JSON content type", async () => {
    buildHealthPayloadMock.mockReturnValue({
      status: "ok",
      application: "Dynamic Organogram Manager",
      environment: "test",
      timestamp: "2026-09-01T00:00:00.000Z",
      version: "0.1.0",
    });

    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const body = await response.json();
    expect(body).toEqual({
      status: "ok",
      application: "Dynamic Organogram Manager",
      environment: "test",
      timestamp: "2026-09-01T00:00:00.000Z",
      version: "0.1.0",
    });
  });

  it("contains no sensitive configuration in the success response", async () => {
    buildHealthPayloadMock.mockReturnValue({
      status: "ok",
      application: "Dynamic Organogram Manager",
      environment: "test",
      timestamp: "2026-09-01T00:00:00.000Z",
      version: null,
    });

    const response = await GET();
    const body = await response.json();
    const serialized = JSON.stringify(body).toLowerCase();
    for (const forbidden of ["password", "secret", "database_url", "stack", "/users/"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("returns 503 and a safe generic body when the health handler throws internally", async () => {
    buildHealthPayloadMock.mockImplementation(() => {
      throw new Error("connect ECONNREFUSED password=hunter2");
    });

    const response = await GET();
    expect(response.status).toBe(503);

    const body = await response.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("ECONNREFUSED");
    expect(body.status).toBe("error");
  });

  it("handles a non-Error thrown value safely", async () => {
    buildHealthPayloadMock.mockImplementation(() => {
      throw "raw string failure";
    });

    const response = await GET();
    expect(response.status).toBe(503);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      "health check failed",
      expect.objectContaining({ reason: "unknown" })
    );
  });

  it("logs the failure server-side without forwarding the raw error message", async () => {
    buildHealthPayloadMock.mockImplementation(() => {
      throw new Error("connect ECONNREFUSED password=hunter2");
    });

    await GET();

    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    const loggedFields = JSON.stringify(loggerErrorMock.mock.calls[0]);
    expect(loggedFields).not.toContain("hunter2");
  });
});
