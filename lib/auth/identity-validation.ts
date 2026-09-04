import { normalizeWorkEmail } from "@/lib/domain/normalize";

/**
 * Pure identity-validation rules applied to an already-verified OIDC
 * profile (Auth.js's OIDC provider type performs issuer/signature/
 * audience validation itself via the underlying openid-client library —
 * that is standard-protocol validation this project does not
 * reimplement, per the standing rule against inventing custom
 * cryptography). What's here is OUR business logic on top: which
 * claims we require, and which company-specific restrictions apply.
 *
 * No Auth.js import here on purpose — fully unit-testable without a
 * live provider or a running Auth.js instance (docs/PROJECT_SPEC.md
 * testing rules; CLAUDE.md §1.7).
 */

export class IdentityValidationError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "missing-email"
      | "unverified-email"
      | "missing-subject"
      | "domain-not-allowed"
      | "tenant-mismatch"
  ) {
    super(message);
    this.name = "IdentityValidationError";
  }
}

export interface RawIdentityProfile {
  email?: string | null;
  email_verified?: boolean | null;
  sub?: string | null;
  [claim: string]: unknown;
}

export interface ValidatedIdentity {
  email: string;
  subject: string;
}

/**
 * Extracts and validates the minimum claims this app requires. Throws
 * `IdentityValidationError` with a specific `reason` for each distinct
 * failure the negative-scenario catalog calls out (missing email claim,
 * unverified email, missing subject identifier).
 */
export function extractIdentityClaims(profile: RawIdentityProfile): ValidatedIdentity {
  if (profile.email_verified === false) {
    throw new IdentityValidationError(
      "Identity provider reported this email address as unverified.",
      "unverified-email"
    );
  }

  const email = normalizeWorkEmail(profile.email ?? null);
  if (!email) {
    throw new IdentityValidationError(
      "Identity provider did not return an email claim.",
      "missing-email"
    );
  }

  const subject = typeof profile.sub === "string" ? profile.sub.trim() : "";
  if (!subject) {
    throw new IdentityValidationError(
      "Identity provider did not return a stable subject identifier.",
      "missing-subject"
    );
  }

  return { email, subject };
}

/**
 * Exact-match only — never a substring/suffix check, which would let a
 * lookalike domain (e.g. "evil-northwind-example.test") pass against an
 * allowed domain of "northwind-example.test".
 */
export function isEmailDomainAllowed(email: string, allowedDomains: readonly string[]): boolean {
  const atIndex = email.lastIndexOf("@");
  if (atIndex === -1) return false;
  const domain = email.slice(atIndex + 1).toLowerCase();
  return allowedDomains.includes(domain);
}

export function assertEmailDomainAllowed(email: string, allowedDomains: readonly string[]): void {
  if (!isEmailDomainAllowed(email, allowedDomains)) {
    throw new IdentityValidationError(
      `Email domain for "${email}" is not an allowed company domain.`,
      "domain-not-allowed"
    );
  }
}

/**
 * No-op (always passes) when `expectedTenantId` is undefined — tenant
 * restriction is optional, provider-neutral configuration
 * (docs/DECISIONS.md P8 resolution).
 */
export function assertTenantAllowed(
  claims: RawIdentityProfile,
  tenantClaimName: string,
  expectedTenantId: string | undefined
): void {
  if (expectedTenantId === undefined) return;
  const actual = claims[tenantClaimName];
  if (actual !== expectedTenantId) {
    throw new IdentityValidationError(
      `Identity provider tenant claim "${tenantClaimName}" did not match the allowed tenant.`,
      "tenant-mismatch"
    );
  }
}
