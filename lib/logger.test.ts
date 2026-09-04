import { afterEach, describe, expect, it, vi } from "vitest";

import { logger } from "./logger";

function firstLoggedEntry(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const [line] = spy.mock.calls[0] ?? [];
  if (typeof line !== "string") throw new Error("expected the logger to be called with a string");
  return JSON.parse(line);
}

describe("logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes info/debug through console.log as structured JSON", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logger.info("something happened", { entityId: "p_001" });

    expect(spy).toHaveBeenCalledTimes(1);
    const entry = firstLoggedEntry(spy);
    expect(entry.level).toBe("info");
    expect(entry.message).toBe("something happened");
    expect(entry.entityId).toBe("p_001");
    expect(() => new Date(entry.timestamp as string).toISOString()).not.toThrow();
  });

  it("writes warnings through console.warn", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    logger.warn("careful");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(firstLoggedEntry(spy).level).toBe("warn");
  });

  it("writes errors through console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logger.error("failed");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(firstLoggedEntry(spy).level).toBe("error");
  });

  it("keeps level/message as well-typed strings even when extra fields are passed", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    logger.info("ok", { entityId: "e_101" });
    const entry = firstLoggedEntry(spy);
    expect(typeof entry.level).toBe("string");
    expect(typeof entry.message).toBe("string");
  });
});
