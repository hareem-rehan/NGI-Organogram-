/**
 * Production preflight (D68) — run before launch and after every
 * production deploy. Read-only: it never writes to the database or
 * changes anything on the site.
 *
 * Usage:
 *   npx dotenv -e .env.production.local -- npm run preflight:production
 *   npm run preflight:production -- --url https://organogram.example.com
 *   npx dotenv -e .env.production.local -- npm run preflight:production -- --url https://...
 *
 * What it checks:
 *   1. Settings (the environment it runs with): every rule in
 *      lib/domain/production-preflight.ts — sign-in bypass off, no
 *      placeholder secrets, the right Supabase connection strings, ...
 *      Skipped with --skip-env (e.g. checking a site from a machine that
 *      has no copy of its settings).
 *   2. Database (when DATABASE_URL is set): reachable, every migration this
 *      code needs is applied, and at least one active ADMIN can sign in.
 *   3. Site (with --url): /api/health and /api/health/ready are 200,
 *      /dev-sign-in is 404, and the security headers are present.
 *
 * It prints variable NAMES and rule descriptions only, never a value, so
 * its output is safe to share. Exit code 1 if anything is an error.
 */
import { EXPECTED_MIGRATIONS, findPendingMigrations } from "../lib/db/expected-migrations";
import {
  checkDeployedResponses,
  checkProductionEnv,
  type DeployedResponse,
  type PreflightFinding,
} from "../lib/domain/production-preflight";

// The environment exactly as given, captured before anything loads
// Prisma: the Prisma client fills in variables missing here from the
// repo's local .env, which would hide a gap in a production settings file.
const givenEnv: Record<string, string | undefined> = { ...process.env };

const args = process.argv.slice(2);
const urlIndex = args.indexOf("--url");
const siteUrl = urlIndex >= 0 ? args[urlIndex + 1]?.replace(/\/+$/, "") : undefined;
const skipEnv = args.includes("--skip-env");

const findings: PreflightFinding[] = [];
const passed: string[] = [];

async function checkDatabase() {
  if (!givenEnv.DATABASE_URL) return;
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: givenEnv.DATABASE_URL });
  try {
    await prisma.$queryRaw`SELECT 1`;
    passed.push("database reachable");
    const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    const pending = findPendingMigrations(
      EXPECTED_MIGRATIONS,
      rows.map((r) => r.migration_name)
    );
    if (pending.length > 0) {
      findings.push({
        level: "error",
        key: "migrations",
        message: `${pending.length} of ${EXPECTED_MIGRATIONS.length} pending (${pending.join(", ")}). Run \`prisma migrate deploy\`.`,
      });
    } else {
      passed.push(`all ${EXPECTED_MIGRATIONS.length} migrations applied`);
    }
    const admins = await prisma.user.count({ where: { role: "ADMIN", status: "ACTIVE" } });
    if (admins === 0) {
      findings.push({
        level: "warning",
        key: "first admin",
        message:
          "No active ADMIN user yet. Provision one after SSO works: `npm run auth:provision` (scripts/provision-user.ts).",
      });
    } else {
      passed.push(`${admins} active admin(s)`);
    }
  } catch (err) {
    const code = (err as { code?: string }).code;
    findings.push({
      level: "error",
      key: "DATABASE_URL",
      message: `Can't query the database${code ? ` (${code})` : ""}${
        code === "P1001" ? " — unreachable or a wrong password" : ""
      }${code === "P2021" ? " — tables missing: run `prisma migrate deploy`" : ""}.`,
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function fetchResponse(path: string): Promise<DeployedResponse> {
  try {
    const res = await fetch(`${siteUrl}${path}`, { redirect: "manual" });
    let json: unknown;
    if (res.headers.get("content-type")?.includes("application/json")) {
      json = await res.json().catch(() => undefined);
    }
    return { status: res.status, headers: Object.fromEntries(res.headers.entries()), json };
  } catch {
    return { status: 0, headers: {} };
  }
}

async function checkSite() {
  const [health, ready, devSignIn, signIn] = await Promise.all([
    fetchResponse("/api/health"),
    fetchResponse("/api/health/ready"),
    fetchResponse("/dev-sign-in"),
    fetchResponse("/sign-in"),
  ]);
  if (health.status === 0) {
    findings.push({ level: "error", key: "--url", message: "Site unreachable." });
    return;
  }
  const siteFindings = checkDeployedResponses({ health, ready, devSignIn, signIn });
  findings.push(...siteFindings);
  if (siteFindings.length === 0) {
    passed.push("health + readiness 200, /dev-sign-in 404, security headers present");
  }
}

async function main() {
  console.log("Production preflight (read-only)");
  if (!skipEnv) {
    const envFindings = checkProductionEnv(givenEnv);
    findings.push(...envFindings);
    if (envFindings.length === 0) passed.push("settings");
    // No point querying a database whose URL is already known to be wrong.
    if (!envFindings.some((f) => f.level === "error" && f.key === "DATABASE_URL")) {
      await checkDatabase();
    }
  }
  if (siteUrl) await checkSite();
  if (skipEnv && !siteUrl) {
    console.error("Nothing to check: pass --url, or drop --skip-env.");
    process.exit(2);
  }

  console.log("");
  for (const p of passed) console.log(`  ✓ ${p}`);
  for (const f of findings) {
    console.log(`  ${f.level === "error" ? "✗" : "!"} ${f.key}: ${f.message}`);
  }
  const errors = findings.filter((f) => f.level === "error").length;
  const warnings = findings.length - errors;
  console.log(
    `\n${errors === 0 ? "READY" : "NOT READY"} — ${errors} error(s), ${warnings} warning(s).`
  );
  process.exit(errors === 0 ? 0 : 1);
}

void main();
