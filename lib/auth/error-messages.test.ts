import { describe, expect, it } from "vitest";

import { safeSignInErrorMessage } from "./error-messages";

describe("safeSignInErrorMessage", () => {
  it("returns null when there is no error code", () => {
    expect(safeSignInErrorMessage(null)).toBeNull();
    expect(safeSignInErrorMessage(undefined)).toBeNull();
  });

  it("returns a specific safe message for AccessDenied", () => {
    expect(safeSignInErrorMessage("AccessDenied")).toMatch(/not authorized|disabled/i);
  });

  it("returns a generic safe message for unknown/provider-internal codes, never the raw code", () => {
    const message = safeSignInErrorMessage("OAuthCallbackError: some raw provider detail");
    expect(message).not.toContain("OAuthCallbackError");
    expect(message).not.toContain("raw provider detail");
    expect(message).toMatch(/went wrong/i);
  });
});
