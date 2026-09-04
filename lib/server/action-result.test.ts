import { describe, expect, it } from "vitest";
import { z } from "zod";

import { runAction } from "./action-result";
import { AppError } from "@/lib/errors";
import { ConflictError } from "@/lib/domain/errors";
import { ForbiddenError, InactiveUserError, UnauthenticatedError } from "@/lib/auth/errors";

describe("runAction", () => {
  it("returns ok:true with the operation's result on success", async () => {
    const result = await runAction(async () => 42);
    expect(result).toEqual({ ok: true, data: 42 });
  });

  it("surfaces an AppError subclass's own safe message", async () => {
    const result = await runAction(async () => {
      throw new ConflictError("Code already in use.");
    });
    expect(result).toEqual({ ok: false, error: "Code already in use." });
  });

  it("maps UnauthenticatedError to an authRedirect to /sign-in", async () => {
    const result = await runAction(async () => {
      throw new UnauthenticatedError();
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.authRedirect).toBe("/sign-in");
  });

  it("maps InactiveUserError to an authRedirect to /sign-in", async () => {
    const result = await runAction(async () => {
      throw new InactiveUserError();
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.authRedirect).toBe("/sign-in");
  });

  it("maps ForbiddenError to an authRedirect to /access-denied", async () => {
    const result = await runAction(async () => {
      throw new ForbiddenError();
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.authRedirect).toBe("/access-denied");
  });

  it("converts a ZodError into field-level errors, never a raw Zod message dump", async () => {
    const schema = z.object({ name: z.string().min(1) });
    const result = await runAction(async () => {
      schema.parse({ name: "" });
      return null;
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors).toHaveProperty("name");
    }
  });

  it("replaces an unexpected non-AppError with a generic message, never the raw error", async () => {
    const result = await runAction(async () => {
      throw new Error('relation "employees" does not exist — password=hunter2');
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain("hunter2");
      expect(result.error).not.toContain("relation");
    }
  });

  it("never leaks a plain AppError base-class instance's internals beyond its own message", async () => {
    const result = await runAction(async () => {
      throw new AppError("A safe, expected message.");
    });
    expect(result).toEqual({ ok: false, error: "A safe, expected message." });
  });
});
