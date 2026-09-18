import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isDevSignInBypassingProduction, isDevSignInEnabled } from "./dev-sign-in-flag";

/**
 * This gate is a security boundary: when it returns true on a deployed
 * environment, anyone who can reach the URL can sign in as ADMIN. The
 * cases below are therefore about what must NOT enable it, as much as
 * what must.
 */
const originalNodeEnv = process.env.NODE_ENV;
const originalFlag = process.env.AUTH_ALLOW_DEV_SIGN_IN;

function setEnv(nodeEnv: string | undefined, flag: string | undefined): void {
  if (nodeEnv === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
  else (process.env as Record<string, string | undefined>).NODE_ENV = nodeEnv;
  if (flag === undefined) delete process.env.AUTH_ALLOW_DEV_SIGN_IN;
  else process.env.AUTH_ALLOW_DEV_SIGN_IN = flag;
}

beforeEach(() => setEnv(originalNodeEnv, undefined));
afterEach(() => setEnv(originalNodeEnv, originalFlag));

describe("isDevSignInEnabled — outside a production build", () => {
  it("is on in development, with no flag needed", () => {
    setEnv("development", undefined);
    expect(isDevSignInEnabled()).toBe(true);
  });

  it("is on in test — this is how the E2E suite signs in", () => {
    setEnv("test", undefined);
    expect(isDevSignInEnabled()).toBe(true);
  });
});

describe("isDevSignInEnabled — on a production build", () => {
  it("is OFF by default", () => {
    setEnv("production", undefined);
    expect(isDevSignInEnabled()).toBe(false);
  });

  it("is on only for the exact string 'true'", () => {
    setEnv("production", "true");
    expect(isDevSignInEnabled()).toBe(true);
  });

  it.each(["false", "0", "no", "off", "", " ", "TRUE", "True", "yes", "1"])(
    "stays OFF for %o — a truthy-looking value must never open it",
    (value) => {
      setEnv("production", value);
      expect(isDevSignInEnabled()).toBe(false);
    }
  );
});

describe("isDevSignInBypassingProduction — what the UI warns about", () => {
  it("is true only when a production build has the bypass on", () => {
    setEnv("production", "true");
    expect(isDevSignInBypassingProduction()).toBe(true);
  });

  it("is false on a normal production build", () => {
    setEnv("production", undefined);
    expect(isDevSignInBypassingProduction()).toBe(false);
  });

  it("is false in ordinary local development, where a warning would be noise", () => {
    setEnv("development", undefined);
    expect(isDevSignInEnabled()).toBe(true);
    expect(isDevSignInBypassingProduction()).toBe(false);
  });

  it("is false in development even if the flag is set, since nothing is being bypassed", () => {
    setEnv("development", "true");
    expect(isDevSignInBypassingProduction()).toBe(false);
  });
});
