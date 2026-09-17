import { z } from "zod";

/**
 * Pure, side-effect-free schemas and parse functions. No "server-only"
 * import here on purpose — this module needs to be unit-testable with
 * arbitrary fake env objects. The actual process.env reads (and the
 * server/client boundary enforcement) live in env.server.ts / env.public.ts.
 */

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /**
   * Required as of Phase 2 (Database and Core Domain Model) — the Prisma
   * client (lib/db/prisma.ts) genuinely connects now. Phase 1 left this
   * optional/reserved since nothing consumed it yet; that's no longer
   * true, so it fails fast here instead of surfacing as a confusing
   * Prisma connection error deeper in the stack.
   */
  DATABASE_URL: z
    .string()
    .trim()
    .min(1, "DATABASE_URL is required and must not be empty")
    .refine(
      (value) => value.startsWith("postgres://") || value.startsWith("postgresql://"),
      "DATABASE_URL must be a PostgreSQL connection string (postgres:// or postgresql://)"
    ),
  /**
   * Optional, and deliberately so: only the Prisma CLI reads it (via
   * `directUrl` in prisma/schema.prisma), never the running app. Making
   * it required here would fail a deployment that migrates from CI and
   * therefore has no reason to carry a direct connection string into its
   * runtime environment. Validated only for SHAPE when it is present, so
   * a typo is caught at boot rather than at the next migration.
   */
  DIRECT_DATABASE_URL: z
    .string()
    .trim()
    .refine(
      (value) => value.startsWith("postgres://") || value.startsWith("postgresql://"),
      "DIRECT_DATABASE_URL must be a PostgreSQL connection string (postgres:// or postgresql://)"
    )
    .optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // ---- Authentication (Phase 3) — Company SSO, provider-neutral OIDC ----
  // See docs/DECISIONS.md (P8 resolution) and
  // docs/adr/0010-authjs-provider-neutral-oidc.md. No Microsoft/Google/
  // tenant/domain/clientId/issuer value is ever hard-coded — all of it
  // comes from here, validated, never logged.

  /** Auth.js's signing/encryption secret. Never logged. */
  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET must be at least 32 characters (used for cookie/token signing)"),

  /** Set to "true" only when running behind a trusted reverse proxy / non-standard host — see Auth.js docs. */
  AUTH_TRUST_HOST: z
    .string()
    .optional()
    .transform((value) => value === "true"),

  /** The OIDC issuer URL. Auth.js discovers endpoints via `${issuer}/.well-known/openid-configuration`. */
  AUTH_OIDC_ISSUER: z.string().trim().url("AUTH_OIDC_ISSUER must be a valid URL"),

  AUTH_OIDC_CLIENT_ID: z.string().trim().min(1, "AUTH_OIDC_CLIENT_ID is required"),

  /** Never sent to the browser; never logged (lib/logger.ts callers must not pass this). */
  AUTH_OIDC_CLIENT_SECRET: z.string().min(1, "AUTH_OIDC_CLIENT_SECRET is required"),

  /**
   * Optional provider-neutral tenant restriction. Interpreted as "the
   * profile claim named AUTH_OIDC_TENANT_CLAIM must equal this value" —
   * see lib/auth/identity-validation.ts. Left unset = no tenant check
   * (only the email-domain allowlist applies).
   */
  AUTH_ALLOWED_TENANT_ID: z.string().trim().min(1).optional(),

  /** Which profile claim carries the tenant identifier, when AUTH_ALLOWED_TENANT_ID is set (e.g. "tid" for Microsoft Entra ID). */
  AUTH_OIDC_TENANT_CLAIM: z.string().trim().min(1).default("tid"),

  /**
   * Comma-separated list of allowed company email domains, e.g.
   * "northwind.example,northwind-labs.example". Required — a Company SSO
   * app with no domain restriction at all is not a safe default. Each
   * entry is normalized (trimmed, lowercased, leading "@" stripped).
   */
  AUTH_ALLOWED_EMAIL_DOMAINS: z
    .string()
    .trim()
    .min(
      1,
      "AUTH_ALLOWED_EMAIL_DOMAINS is required — a wildcard/empty allowlist is not a safe default"
    )
    .transform((value) =>
      value
        .split(",")
        .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
        .filter((domain) => domain.length > 0)
    )
    .refine(
      (domains) => domains.length > 0,
      "AUTH_ALLOWED_EMAIL_DOMAINS must list at least one domain"
    )
    .refine(
      (domains) =>
        domains.every((domain) =>
          /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)
        ),
      "AUTH_ALLOWED_EMAIL_DOMAINS contains an invalid domain"
    ),

  /** Display label only (e.g. "Sign in with Northwind Account") — never a vendor name hard-coded in UI copy. */
  AUTH_PROVIDER_NAME: z.string().trim().min(1).default("Company Account"),

  /** Defaults to disabled — an unknown allowed-domain user gets an access-request page, not automatic VIEWER access, unless explicitly enabled. */
  AUTH_AUTO_PROVISION_VIEWERS: z
    .string()
    .optional()
    .transform((value) => value === "true"),

  /**
   * Opens the local-development sign-in page on a DEPLOYED environment,
   * which otherwise refuses to exist there. Absent means off; only the
   * exact string "true" enables it.
   *
   * This bypasses Company SSO entirely — anyone who can reach the URL can
   * sign in as ADMIN. It exists so a staging deployment is usable before
   * an identity provider has been registered, and for nothing else. The
   * header shows a standing warning while it is on, and the production
   * deploy job fails if it finds the page reachable.
   *
   * Declared here for validation and documentation. The gate itself
   * (lib/auth/dev-sign-in.ts) reads process.env directly, so it cannot
   * depend on when this config is constructed.
   */
  AUTH_ALLOW_DEV_SIGN_IN: z
    .string()
    .optional()
    .transform((value) => value === "true"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_NAME: z
    .string()
    .trim()
    .min(1, "NEXT_PUBLIC_APP_NAME is required and must not be empty"),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export class EnvValidationError extends Error {
  readonly issues: string[];

  constructor(scope: "server" | "public", error: z.ZodError) {
    const issues = error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`
    );
    super(
      `Invalid ${scope} environment configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`
    );
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

export function parseServerEnv(raw: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(raw);
  if (!result.success) {
    throw new EnvValidationError("server", result.error);
  }
  return result.data;
}

/**
 * Inert stand-ins used ONLY to let `next build` evaluate server modules
 * without a database or real secrets present — never read at runtime.
 */
const BUILD_PLACEHOLDERS: Readonly<Record<string, string>> = {
  DATABASE_URL: "postgresql://build-placeholder:build@localhost:5432/build",
  AUTH_SECRET: "build-phase-placeholder-secret-never-used-at-runtime-000000",
  AUTH_OIDC_ISSUER: "https://build-placeholder.invalid",
  AUTH_OIDC_CLIENT_ID: "build-placeholder",
  AUTH_OIDC_CLIENT_SECRET: "build-placeholder",
  AUTH_ALLOWED_EMAIL_DOMAINS: "build-placeholder.invalid",
};

/**
 * Parses the server env, tolerating MISSING runtime secrets only during
 * `next build` (`isBuildPhase`). The build has no database and no real
 * secrets and must not require them; the values are read on the running
 * server, which re-evaluates with the real environment.
 *
 * A value that IS present is still validated, in every phase — a
 * placeholder only ever fills a genuinely absent key, so a malformed real
 * value fails the build just as it fails at runtime, and outside the
 * build phase this behaves exactly like `parseServerEnv`.
 */
export function resolveServerEnv(
  raw: Record<string, string | undefined>,
  options: { isBuildPhase: boolean }
): ServerEnv {
  if (!options.isBuildPhase) {
    return parseServerEnv(raw);
  }
  const merged: Record<string, string | undefined> = { ...raw };
  for (const [key, placeholder] of Object.entries(BUILD_PLACEHOLDERS)) {
    if (!merged[key]) merged[key] = placeholder;
  }
  return parseServerEnv(merged);
}

export function parsePublicEnv(raw: Record<string, string | undefined>): PublicEnv {
  const result = publicEnvSchema.safeParse({
    NEXT_PUBLIC_APP_NAME: raw.NEXT_PUBLIC_APP_NAME,
  });
  if (!result.success) {
    throw new EnvValidationError("public", result.error);
  }
  return result.data;
}
