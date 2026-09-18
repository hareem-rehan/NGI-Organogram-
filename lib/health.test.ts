import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env.public", () => ({
  publicEnv: { NEXT_PUBLIC_APP_NAME: "DotZero Organogram" },
}));
vi.mock("@/lib/version", () => ({
  getAppVersion: vi.fn(() => "0.1.0"),
}));

import { buildHealthPayload } from "./health";
import { getAppVersion } from "@/lib/version";

describe("buildHealthPayload", () => {
  afterEach(() => {
    vi.mocked(getAppVersion).mockReturnValue("0.1.0");
  });

  it("returns only safe operational fields", () => {
    const payload = buildHealthPayload();
    expect(payload).toEqual({
      status: "ok",
      application: "DotZero Organogram",
      environment: expect.any(String),
      timestamp: expect.any(String),
      version: "0.1.0",
    });
  });

  it("never includes a secrets/database/path-shaped key", () => {
    const payload = buildHealthPayload();
    const keys = Object.keys(payload);
    for (const forbidden of ["databaseUrl", "DATABASE_URL", "secret", "stack", "path"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("falls back to null version rather than throwing when unavailable", () => {
    vi.mocked(getAppVersion).mockReturnValue(null);
    const payload = buildHealthPayload();
    expect(payload.version).toBeNull();
    expect(payload.status).toBe("ok");
  });

  it("produces a parseable ISO timestamp", () => {
    const payload = buildHealthPayload();
    expect(() => new Date(payload.timestamp).toISOString()).not.toThrow();
  });
});
