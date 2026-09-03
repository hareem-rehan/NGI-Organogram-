import { describe, expect, it } from "vitest";

import { EnvValidationError, parsePublicEnv, parseServerEnv } from "./env";

describe("parsePublicEnv", () => {
  it("accepts a valid configuration", () => {
    const result = parsePublicEnv({ NEXT_PUBLIC_APP_NAME: "Dynamic Organogram Manager" });
    expect(result.NEXT_PUBLIC_APP_NAME).toBe("Dynamic Organogram Manager");
  });

  it("fails fast when the required public variable is missing", () => {
    expect(() => parsePublicEnv({})).toThrow(EnvValidationError);
  });

  it("fails fast when the required public variable is whitespace-only", () => {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_APP_NAME: "   " })).toThrow(EnvValidationError);
  });

  it("includes the offending field name in the error for diagnosability", () => {
    try {
      parsePublicEnv({});
      expect.fail("expected parsePublicEnv to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).issues.join()).toContain("NEXT_PUBLIC_APP_NAME");
    }
  });
});

const VALID_DATABASE_URL = "postgresql://user:pass@localhost:5432/organogram_dev";

/** A minimal, fully valid server env — every test below starts from this and overrides just the field under test. */
const VALID_SERVER_ENV = {
  DATABASE_URL: VALID_DATABASE_URL,
  AUTH_SECRET: "a".repeat(32),
  AUTH_OIDC_ISSUER: "https://idp.example.test",
  AUTH_OIDC_CLIENT_ID: "test-client-id",
  AUTH_OIDC_CLIENT_SECRET: "test-client-secret",
  AUTH_ALLOWED_EMAIL_DOMAINS: "northwind-example.test",
};

describe("parseServerEnv", () => {
  it("accepts a minimal valid configuration", () => {
    const result = parseServerEnv({ NODE_ENV: "development", ...VALID_SERVER_ENV });
    expect(result.NODE_ENV).toBe("development");
    expect(result.DATABASE_URL).toBe(VALID_DATABASE_URL);
    expect(result.LOG_LEVEL).toBe("info");
  });

  it("rejects a missing DATABASE_URL (required as of Phase 2)", () => {
    const { DATABASE_URL: _omit, ...rest } = VALID_SERVER_ENV;
    void _omit;
    expect(() => parseServerEnv(rest)).toThrow(EnvValidationError);
  });

  it("rejects a malformed DATABASE_URL", () => {
    expect(() =>
      parseServerEnv({ ...VALID_SERVER_ENV, DATABASE_URL: "not-a-postgres-url" })
    ).toThrow(EnvValidationError);
  });

  it("rejects an explicitly empty or whitespace-only DATABASE_URL", () => {
    expect(() => parseServerEnv({ ...VALID_SERVER_ENV, DATABASE_URL: "" })).toThrow(
      EnvValidationError
    );
    expect(() => parseServerEnv({ ...VALID_SERVER_ENV, DATABASE_URL: "   " })).toThrow(
      EnvValidationError
    );
  });

  it("rejects an invalid LOG_LEVEL", () => {
    expect(() => parseServerEnv({ ...VALID_SERVER_ENV, LOG_LEVEL: "verbose" })).toThrow(
      EnvValidationError
    );
  });

  it("defaults NODE_ENV to development when unset", () => {
    const result = parseServerEnv(VALID_SERVER_ENV);
    expect(result.NODE_ENV).toBe("development");
  });
});

describe("parseServerEnv — authentication configuration (Phase 3)", () => {
  it("accepts a valid provider-neutral OIDC configuration", () => {
    const result = parseServerEnv(VALID_SERVER_ENV);
    expect(result.AUTH_OIDC_ISSUER).toBe("https://idp.example.test");
    expect(result.AUTH_ALLOWED_EMAIL_DOMAINS).toEqual(["northwind-example.test"]);
    expect(result.AUTH_AUTO_PROVISION_VIEWERS).toBe(false);
    expect(result.AUTH_PROVIDER_NAME).toBe("Company Account");
  });

  it("rejects a missing AUTH_SECRET", () => {
    const { AUTH_SECRET: _omit, ...rest } = VALID_SERVER_ENV;
    void _omit;
    expect(() => parseServerEnv(rest)).toThrow(EnvValidationError);
  });

  it("rejects an AUTH_SECRET shorter than 32 characters", () => {
    expect(() => parseServerEnv({ ...VALID_SERVER_ENV, AUTH_SECRET: "too-short" })).toThrow(
      EnvValidationError
    );
  });

  it("rejects a missing client ID", () => {
    const { AUTH_OIDC_CLIENT_ID: _omit, ...rest } = VALID_SERVER_ENV;
    void _omit;
    expect(() => parseServerEnv(rest)).toThrow(EnvValidationError);
  });

  it("rejects a missing client secret", () => {
    const { AUTH_OIDC_CLIENT_SECRET: _omit, ...rest } = VALID_SERVER_ENV;
    void _omit;
    expect(() => parseServerEnv(rest)).toThrow(EnvValidationError);
  });

  it("rejects an invalid issuer URL", () => {
    expect(() => parseServerEnv({ ...VALID_SERVER_ENV, AUTH_OIDC_ISSUER: "not-a-url" })).toThrow(
      EnvValidationError
    );
  });

  it("rejects an empty allowed-domain list", () => {
    expect(() => parseServerEnv({ ...VALID_SERVER_ENV, AUTH_ALLOWED_EMAIL_DOMAINS: "" })).toThrow(
      EnvValidationError
    );
    expect(() =>
      parseServerEnv({ ...VALID_SERVER_ENV, AUTH_ALLOWED_EMAIL_DOMAINS: "   " })
    ).toThrow(EnvValidationError);
  });

  it("rejects a malformed domain in the allowed-domain list", () => {
    expect(() =>
      parseServerEnv({ ...VALID_SERVER_ENV, AUTH_ALLOWED_EMAIL_DOMAINS: "not a domain" })
    ).toThrow(EnvValidationError);
  });

  it("normalizes a comma-separated, mixed-case, whitespace-padded domain list", () => {
    const result = parseServerEnv({
      ...VALID_SERVER_ENV,
      AUTH_ALLOWED_EMAIL_DOMAINS: " Northwind-Example.test , @Other-Example.test ",
    });
    expect(result.AUTH_ALLOWED_EMAIL_DOMAINS).toEqual([
      "northwind-example.test",
      "other-example.test",
    ]);
  });

  it("defaults AUTH_AUTO_PROVISION_VIEWERS to false (deny-by-default)", () => {
    const result = parseServerEnv(VALID_SERVER_ENV);
    expect(result.AUTH_AUTO_PROVISION_VIEWERS).toBe(false);
  });

  it("enables AUTH_AUTO_PROVISION_VIEWERS only on the exact string 'true'", () => {
    expect(
      parseServerEnv({ ...VALID_SERVER_ENV, AUTH_AUTO_PROVISION_VIEWERS: "true" })
        .AUTH_AUTO_PROVISION_VIEWERS
    ).toBe(true);
    expect(
      parseServerEnv({ ...VALID_SERVER_ENV, AUTH_AUTO_PROVISION_VIEWERS: "yes" })
        .AUTH_AUTO_PROVISION_VIEWERS
    ).toBe(false);
  });

  it("defaults AUTH_OIDC_TENANT_CLAIM to 'tid' when unset", () => {
    const result = parseServerEnv(VALID_SERVER_ENV);
    expect(result.AUTH_OIDC_TENANT_CLAIM).toBe("tid");
  });
});
