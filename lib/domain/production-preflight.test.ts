import { describe, expect, it } from "vitest";

import { oidcIssuerOrigin } from "@/proxy";
import { checkDeployedResponses, checkProductionEnv } from "./production-preflight";

/** A production configuration that passes every check. */
const GOOD = {
  NEXT_PUBLIC_APP_NAME: "DotZero Organogram",
  DATABASE_URL:
    "postgresql://postgres.abcdefgh:s3cr3tPassw0rd@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5",
  DIRECT_DATABASE_URL:
    "postgresql://postgres.abcdefgh:s3cr3tPassw0rd@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres",
  AUTH_SECRET: "q1W2e3R4t5Y6u7I8o9P0a1S2d3F4g5H6j7K8l9Z0x1C=",
  AUTH_TRUST_HOST: "true",
  AUTH_OIDC_ISSUER: "https://accounts.google.com",
  AUTH_OIDC_CLIENT_ID: "1234567890-abc.apps.googleusercontent.com",
  AUTH_OIDC_CLIENT_SECRET: "GOCSPX-realLookingSecretValue",
  AUTH_ALLOWED_EMAIL_DOMAINS: "nextgeni.com",
  AUTH_ALLOWED_TENANT_ID: "nextgeni.com",
  AUTH_OIDC_TENANT_CLAIM: "hd",
};

const keysOf = (env: Record<string, string | undefined>) =>
  checkProductionEnv(env).map((f) => `${f.level}:${f.key}`);

describe("checkProductionEnv (D68)", () => {
  it("passes a correct Supabase + Google Workspace production config", () => {
    expect(checkProductionEnv(GOOD)).toEqual([]);
  });

  it("never echoes a value back, only variable names and rules", () => {
    const bad = { ...GOOD, AUTH_SECRET: "placeholder-secret-value-that-is-long-enough!!" };
    const text = JSON.stringify(checkProductionEnv(bad));
    expect(text).not.toContain("placeholder-secret-value");
    expect(text).not.toContain("s3cr3tPassw0rd");
  });

  it("refuses the sign-in bypass in any form", () => {
    for (const value of ["true", "false", ""]) {
      expect(keysOf({ ...GOOD, AUTH_ALLOW_DEV_SIGN_IN: value })).toContain(
        "error:AUTH_ALLOW_DEV_SIGN_IN"
      );
    }
  });

  it("flags placeholders, a missing trust-host, and an overridden NODE_ENV", () => {
    const keys = keysOf({
      ...GOOD,
      AUTH_SECRET: "ci-only-placeholder-secret-value-not-a-real-secret-32chars",
      AUTH_OIDC_CLIENT_ID: "your-client-id",
      AUTH_ALLOWED_EMAIL_DOMAINS: "northwind-example.test",
      AUTH_ALLOWED_TENANT_ID: "<company-domain>",
      AUTH_TRUST_HOST: undefined,
      NODE_ENV: "development",
    });
    expect(keys).toEqual(
      expect.arrayContaining([
        "error:AUTH_SECRET",
        "error:AUTH_OIDC_CLIENT_ID",
        "error:AUTH_ALLOWED_EMAIL_DOMAINS",
        "error:AUTH_ALLOWED_TENANT_ID",
        "error:AUTH_TRUST_HOST",
        "error:NODE_ENV",
      ])
    );
  });

  it("reports missing required settings through the app's own validation", () => {
    const keys = keysOf({ ...GOOD, AUTH_OIDC_CLIENT_SECRET: undefined, NEXT_PUBLIC_APP_NAME: "" });
    expect(keys).toEqual(
      expect.arrayContaining(["error:AUTH_OIDC_CLIENT_SECRET", "error:NEXT_PUBLIC_APP_NAME"])
    );
  });

  it("requires the hd claim for a Google Workspace tenant check", () => {
    expect(keysOf({ ...GOOD, AUTH_OIDC_TENANT_CLAIM: undefined })).toContain(
      "error:AUTH_OIDC_TENANT_CLAIM"
    );
  });

  it("catches the Supabase connection-string mix-ups from the runbook", () => {
    expect(
      keysOf({ ...GOOD, DATABASE_URL: GOOD.DATABASE_URL.replace("?pgbouncer=true&", "?") })
    ).toContain("error:DATABASE_URL");
    expect(keysOf({ ...GOOD, DIRECT_DATABASE_URL: GOOD.DATABASE_URL })).toContain(
      "error:DIRECT_DATABASE_URL"
    );
    expect(
      keysOf({
        ...GOOD,
        DIRECT_DATABASE_URL: GOOD.DIRECT_DATABASE_URL.replace("abcdefgh", "zzzzzzzz"),
      })
    ).toContain("error:DIRECT_DATABASE_URL");
    expect(
      keysOf({ ...GOOD, DATABASE_URL: "postgresql://u:p@localhost:5433/organogram_dev" })
    ).toContain("error:DATABASE_URL");
    expect(
      keysOf({
        ...GOOD,
        DIRECT_DATABASE_URL: "postgresql://postgres:p@db.abcdefgh.supabase.co:5432/postgres",
      })
    ).toContain("warning:DIRECT_DATABASE_URL");
    expect(keysOf({ ...GOOD, DIRECT_DATABASE_URL: undefined })).toEqual([
      "warning:DIRECT_DATABASE_URL",
    ]);
  });
});

describe("checkDeployedResponses (D68)", () => {
  const headers = {
    "Strict-Transport-Security": "max-age=63072000",
    "Content-Security-Policy": "default-src 'self'",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
  };
  const ok = {
    health: { status: 200, headers: {} },
    ready: { status: 200, headers: {} },
    devSignIn: { status: 404, headers: {} },
    signIn: { status: 200, headers },
  };

  it("passes a healthy, locked-down site", () => {
    expect(checkDeployedResponses(ok)).toEqual([]);
  });

  it("flags a reachable sign-in bypass, an unmigrated database and missing headers", () => {
    const keys = checkDeployedResponses({
      ...ok,
      devSignIn: { status: 200, headers: {} },
      ready: { status: 503, headers: {}, json: { database: "reachable", schema: "pending" } },
      signIn: { status: 200, headers: {} },
    });
    expect(keys.map((f) => f.key)).toEqual([
      "/api/health/ready",
      "/dev-sign-in",
      "strict-transport-security",
      "content-security-policy",
      "x-frame-options",
      "x-content-type-options",
    ]);
    expect(keys[0]!.message).toMatch(/migrate deploy/);
  });
});

describe("oidcIssuerOrigin (D68)", () => {
  it("returns the https origin of the sign-in provider, else null", () => {
    expect(oidcIssuerOrigin("https://accounts.google.com")).toBe("https://accounts.google.com");
    expect(oidcIssuerOrigin("https://login.microsoftonline.com/tenant/v2.0")).toBe(
      "https://login.microsoftonline.com"
    );
    expect(oidcIssuerOrigin("http://insecure.example")).toBeNull();
    expect(oidcIssuerOrigin("not a url")).toBeNull();
    expect(oidcIssuerOrigin(undefined)).toBeNull();
  });
});
