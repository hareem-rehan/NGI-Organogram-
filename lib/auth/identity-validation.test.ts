import { describe, expect, it } from "vitest";

import {
  assertEmailDomainAllowed,
  assertTenantAllowed,
  extractIdentityClaims,
  IdentityValidationError,
  isEmailDomainAllowed,
} from "./identity-validation";

describe("extractIdentityClaims", () => {
  it("accepts a valid profile with email and subject", () => {
    const result = extractIdentityClaims({ email: "  Jane.Doe@Example.TEST ", sub: "abc-123" });
    expect(result).toEqual({ email: "jane.doe@example.test", subject: "abc-123" });
  });

  it("rejects a missing email claim", () => {
    expect(() => extractIdentityClaims({ sub: "abc-123" })).toThrow(IdentityValidationError);
    try {
      extractIdentityClaims({ sub: "abc-123" });
    } catch (error) {
      expect((error as IdentityValidationError).reason).toBe("missing-email");
    }
  });

  it("rejects an explicitly unverified email", () => {
    expect(() =>
      extractIdentityClaims({ email: "jane@example.test", email_verified: false, sub: "abc" })
    ).toThrow(IdentityValidationError);
    try {
      extractIdentityClaims({ email: "jane@example.test", email_verified: false, sub: "abc" });
    } catch (error) {
      expect((error as IdentityValidationError).reason).toBe("unverified-email");
    }
  });

  it("accepts a profile with no email_verified claim at all (not every provider sends it)", () => {
    expect(() => extractIdentityClaims({ email: "jane@example.test", sub: "abc" })).not.toThrow();
  });

  it("rejects a missing subject identifier", () => {
    expect(() => extractIdentityClaims({ email: "jane@example.test" })).toThrow(
      IdentityValidationError
    );
    try {
      extractIdentityClaims({ email: "jane@example.test" });
    } catch (error) {
      expect((error as IdentityValidationError).reason).toBe("missing-subject");
    }
  });

  it("rejects a whitespace-only subject identifier", () => {
    expect(() => extractIdentityClaims({ email: "jane@example.test", sub: "   " })).toThrow(
      IdentityValidationError
    );
  });
});

describe("isEmailDomainAllowed / assertEmailDomainAllowed", () => {
  const allowed = ["northwind-example.test"];

  it("accepts an email on an allowed domain", () => {
    expect(isEmailDomainAllowed("amara@northwind-example.test", allowed)).toBe(true);
  });

  it("rejects an email on an external domain", () => {
    expect(isEmailDomainAllowed("amara@external-company.test", allowed)).toBe(false);
  });

  it("rejects a lookalike domain (not a substring/suffix match)", () => {
    expect(isEmailDomainAllowed("amara@evil-northwind-example.test", allowed)).toBe(false);
    expect(isEmailDomainAllowed("amara@northwind-example.test.evil.test", allowed)).toBe(false);
  });

  it("assertEmailDomainAllowed throws IdentityValidationError with reason 'domain-not-allowed'", () => {
    try {
      assertEmailDomainAllowed("amara@external-company.test", allowed);
      expect.fail("expected assertEmailDomainAllowed to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityValidationError);
      expect((error as IdentityValidationError).reason).toBe("domain-not-allowed");
    }
  });
});

describe("assertTenantAllowed", () => {
  it("is a no-op when no tenant is configured", () => {
    expect(() => assertTenantAllowed({ tid: "anything" }, "tid", undefined)).not.toThrow();
  });

  it("accepts a matching tenant claim", () => {
    expect(() => assertTenantAllowed({ tid: "tenant-1" }, "tid", "tenant-1")).not.toThrow();
  });

  it("rejects a mismatched tenant claim", () => {
    expect(() => assertTenantAllowed({ tid: "tenant-2" }, "tid", "tenant-1")).toThrow(
      IdentityValidationError
    );
  });

  it("rejects a missing tenant claim when a tenant is required", () => {
    expect(() => assertTenantAllowed({}, "tid", "tenant-1")).toThrow(IdentityValidationError);
  });
});
