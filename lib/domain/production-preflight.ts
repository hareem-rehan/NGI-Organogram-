import { serverEnvSchema } from "@/lib/env";

/**
 * Production preflight (D68): checks a production environment's settings
 * BEFORE launch, for the mistakes the deployment runbook warns about —
 * the sign-in bypass left on, a placeholder secret, the wrong Supabase
 * connection string, a localhost database. Pure: it reads the env object
 * it is given and returns findings. No DB, no network.
 *
 * Findings never contain a value from the environment, only variable
 * names, so the output is safe to paste into a ticket or chat.
 */

export type PreflightLevel = "error" | "warning";

export interface PreflightFinding {
  level: PreflightLevel;
  /** The variable (or area) the finding is about. */
  key: string;
  message: string;
}

type Env = Record<string, string | undefined>;

/** Words that mark a value as a template/placeholder rather than a real one. */
const PLACEHOLDER = /placeholder|changeme|change-me|example|your-|<|>|\.invalid\b|\.test\b/i;

function hostAndPort(url: string): { host: string; port: string; params: URLSearchParams } | null {
  try {
    const parsed = new URL(url);
    return { host: parsed.hostname, port: parsed.port || "5432", params: parsed.searchParams };
  } catch {
    return null;
  }
}

const isLocalHost = (host: string) =>
  host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
const isSupabasePooler = (host: string) => host.endsWith(".pooler.supabase.com");
const isSupabaseDirect = (host: string) => /^db\.[^.]+\.supabase\.co$/.test(host);

export function checkProductionEnv(env: Env): PreflightFinding[] {
  const findings: PreflightFinding[] = [];
  const error = (key: string, message: string) => findings.push({ level: "error", key, message });
  const warning = (key: string, message: string) =>
    findings.push({ level: "warning", key, message });

  // The app's own validation, exactly as it runs at boot. Zod's messages
  // name the rule, never the value.
  const parsed = serverEnvSchema.safeParse({ ...env, NODE_ENV: "production" });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      error(issue.path.join(".") || "(env)", issue.message);
    }
  }
  if (!env.NEXT_PUBLIC_APP_NAME?.trim()) {
    error("NEXT_PUBLIC_APP_NAME", "Required (it is baked in at build time).");
  }

  // Vercel sets NODE_ENV=production itself; the dev sign-in gate depends on it.
  if (env.NODE_ENV !== undefined && env.NODE_ENV !== "production") {
    error(
      "NODE_ENV",
      "Don't set it — the host sets it to production, and the sign-in gate relies on that."
    );
  }

  // The sign-in bypass hands ADMIN to anyone with the URL.
  if (env.AUTH_ALLOW_DEV_SIGN_IN !== undefined) {
    error(
      "AUTH_ALLOW_DEV_SIGN_IN",
      "Must not be set in production at all — it lets anyone sign in as ADMIN without SSO."
    );
  }

  if (env.AUTH_SECRET && PLACEHOLDER.test(env.AUTH_SECRET)) {
    error("AUTH_SECRET", "Looks like a placeholder. Generate one with `openssl rand -base64 32`.");
  }
  if (env.AUTH_TRUST_HOST !== "true") {
    error("AUTH_TRUST_HOST", 'Must be "true" on Vercel, or sign-in fails with UntrustedHost.');
  }

  for (const key of ["AUTH_OIDC_CLIENT_ID", "AUTH_OIDC_CLIENT_SECRET"] as const) {
    if (env[key] && PLACEHOLDER.test(env[key]!)) {
      error(key, "Looks like a placeholder, not the real value from the identity provider.");
    }
  }

  const issuer = env.AUTH_OIDC_ISSUER?.trim();
  if (issuer) {
    if (!issuer.startsWith("https://")) error("AUTH_OIDC_ISSUER", "Must be an https:// URL.");
    if (PLACEHOLDER.test(issuer)) error("AUTH_OIDC_ISSUER", "Looks like a placeholder.");
    const isGoogle = /^https:\/\/accounts\.google\.com\/?$/.test(issuer);
    if (isGoogle && env.AUTH_ALLOWED_TENANT_ID && (env.AUTH_OIDC_TENANT_CLAIM ?? "tid") !== "hd") {
      error(
        "AUTH_OIDC_TENANT_CLAIM",
        'Must be "hd" for Google Workspace (the default "tid" is Microsoft\'s claim).'
      );
    }
  }

  const domains = env.AUTH_ALLOWED_EMAIL_DOMAINS?.split(",").map((d) => d.trim()) ?? [];
  if (env.AUTH_ALLOWED_TENANT_ID && PLACEHOLDER.test(env.AUTH_ALLOWED_TENANT_ID)) {
    error(
      "AUTH_ALLOWED_TENANT_ID",
      "Looks like a placeholder; for Google Workspace it's the company domain."
    );
  }
  if (domains.some((d) => PLACEHOLDER.test(d))) {
    error(
      "AUTH_ALLOWED_EMAIL_DOMAINS",
      "Contains a placeholder/test domain; list the real company domain(s)."
    );
  }

  if (env.AUTH_AUTO_PROVISION_VIEWERS === "true") {
    warning(
      "AUTH_AUTO_PROVISION_VIEWERS",
      "On: anyone in the allowed domain(s) gets VIEWER access on first sign-in. Make sure that's intended."
    );
  }

  // Database connection strings (docs/DEPLOYMENT_RUNBOOK.md §2b).
  const db = env.DATABASE_URL ? hostAndPort(env.DATABASE_URL) : null;
  if (env.DATABASE_URL && !db) error("DATABASE_URL", "Not a valid URL.");
  if (db) {
    if (isLocalHost(db.host))
      error("DATABASE_URL", "Points at this machine, not the production database.");
    if (isSupabasePooler(db.host)) {
      if (db.port !== "6543") {
        warning(
          "DATABASE_URL",
          "Uses the Supabase session pooler (5432). The app should use the transaction pooler (port 6543)."
        );
      } else if (db.params.get("pgbouncer") !== "true") {
        error(
          "DATABASE_URL",
          "Transaction pooler URL needs `?pgbouncer=true` (and a connection_limit)."
        );
      }
    }
    if (isSupabaseDirect(db.host)) {
      warning(
        "DATABASE_URL",
        "Uses Supabase's direct host (IPv6-only on most plans). Use the transaction pooler (port 6543)."
      );
    }
  }

  const direct = env.DIRECT_DATABASE_URL ? hostAndPort(env.DIRECT_DATABASE_URL) : null;
  if (!env.DIRECT_DATABASE_URL) {
    warning(
      "DIRECT_DATABASE_URL",
      "Not set. The app doesn't need it, but `prisma migrate deploy` does (wherever migrations run)."
    );
  } else if (!direct) {
    error("DIRECT_DATABASE_URL", "Not a valid URL.");
  } else {
    if (isLocalHost(direct.host)) {
      error("DIRECT_DATABASE_URL", "Points at this machine, not the production database.");
    }
    if (isSupabasePooler(direct.host) && direct.port === "6543") {
      error(
        "DIRECT_DATABASE_URL",
        "Is the transaction pooler (6543); migrations need the session pooler (5432)."
      );
    }
    if (isSupabaseDirect(direct.host)) {
      warning(
        "DIRECT_DATABASE_URL",
        "Supabase's direct host is IPv6-only on most plans; the session pooler (5432) works everywhere."
      );
    }
    if (
      db &&
      direct.host !== db.host &&
      isSupabasePooler(db.host) &&
      isSupabasePooler(direct.host)
    ) {
      error(
        "DIRECT_DATABASE_URL",
        "Is on a different Supabase host than DATABASE_URL — two databases?"
      );
    }
    const user = (url: string) => {
      try {
        return new URL(url).username;
      } catch {
        return "";
      }
    };
    if (db && env.DATABASE_URL && user(env.DATABASE_URL) !== user(env.DIRECT_DATABASE_URL)) {
      error(
        "DIRECT_DATABASE_URL",
        "Has a different database user (Supabase project) from DATABASE_URL — two databases?"
      );
    }
  }

  return findings;
}

export interface DeployedResponse {
  status: number;
  headers: Record<string, string>;
  /** Parsed JSON body, when there was one. */
  json?: unknown;
}

/**
 * Checks a deployed site's responses: the health probes are green, the
 * sign-in bypass is absent, and the security headers are present.
 */
export function checkDeployedResponses(responses: {
  health: DeployedResponse;
  ready: DeployedResponse;
  devSignIn: DeployedResponse;
  signIn: DeployedResponse;
}): PreflightFinding[] {
  const findings: PreflightFinding[] = [];
  const error = (key: string, message: string) => findings.push({ level: "error", key, message });

  if (responses.health.status !== 200) {
    error(
      "/api/health",
      `Returned ${responses.health.status}, expected 200 (the app didn't boot or its settings are invalid).`
    );
  }
  if (responses.ready.status !== 200) {
    const body = responses.ready.json as { database?: string; schema?: string } | undefined;
    const why =
      body?.database === "unreachable"
        ? "the database is unreachable — check DATABASE_URL"
        : body?.schema === "pending"
          ? "migrations are pending — run `prisma migrate deploy`"
          : body?.schema === "missing"
            ? "the database is empty — run `prisma migrate deploy`"
            : "see the server log";
    error("/api/health/ready", `Returned ${responses.ready.status}: ${why}.`);
  }
  if (responses.devSignIn.status !== 404) {
    error(
      "/dev-sign-in",
      `Returned ${responses.devSignIn.status}, expected 404 — the sign-in bypass is ON. Remove AUTH_ALLOW_DEV_SIGN_IN and redeploy.`
    );
  }
  const headers = Object.fromEntries(
    Object.entries(responses.signIn.headers).map(([k, v]) => [k.toLowerCase(), v])
  );
  for (const name of [
    "strict-transport-security",
    "content-security-policy",
    "x-frame-options",
    "x-content-type-options",
  ]) {
    if (!headers[name]) error(name, "Security header missing on /sign-in.");
  }
  return findings;
}
