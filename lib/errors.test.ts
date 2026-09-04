import { describe, expect, it } from "vitest";

import { AppError, toSafeErrorMessage } from "./errors";

describe("toSafeErrorMessage", () => {
  it("returns the AppError's own message (expected errors are safe to show)", () => {
    const error = new AppError("The position code POS-001 is already in use.");
    expect(toSafeErrorMessage(error)).toBe("The position code POS-001 is already in use.");
  });

  it("returns a generic fallback for a plain Error, never the raw message", () => {
    const error = new Error("connect ECONNREFUSED 127.0.0.1:5432 password=hunter2");
    const message = toSafeErrorMessage(error);
    expect(message).not.toContain("hunter2");
    expect(message).not.toContain("ECONNREFUSED");
    expect(message).toMatch(/something went wrong/i);
  });

  it("returns the generic fallback for a non-Error thrown value", () => {
    expect(toSafeErrorMessage("some raw string")).toMatch(/something went wrong/i);
    expect(toSafeErrorMessage(undefined)).toMatch(/something went wrong/i);
    expect(toSafeErrorMessage({ secret: "value" })).toMatch(/something went wrong/i);
  });
});
