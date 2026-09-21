/**
 * Bootstrap access BEFORE an SSO provider exists.
 *
 * This app authenticates only through Company SSO — there is no password
 * anywhere (docs/adr/0010). That leaves a genuine chicken-and-egg problem
 * on a fresh deployment: you cannot sign in to load data, and you cannot
 * configure anything through the UI until you can sign in.
 *
 * This writes an Auth.js database session directly, which is what the
 * E2E suite already does (e2e/support/seed-session.ts). It grants NO new
 * capability: it needs the database connection string, and anyone holding
 * that can already read and write every row. It changes no application
 * code, ships nothing, and the session expires on its own.
 *
 * It is a bootstrap tool, not a login mechanism. Configure a real OIDC
 * provider and stop using it.
 *
 * Usage:
 *   npx tsx scripts/provision-session.ts \
 *     --email you@company.com --company DOTZERO --yes-bypass-sso
 *
 * Options:
 *   --role   ADMIN | HR_EDITOR | VIEWER   (default ADMIN)
 *   --hours  session lifetime             (default 12, max 168)
 */
import { parseArgs } from "node:util";
import { randomBytes } from "node:crypto";
import { PrismaClient, type UserRole } from "@prisma/client";

import { normalizeWorkEmail } from "../lib/domain/normalize";

const VALID_ROLES: readonly UserRole[] = ["ADMIN", "HR_EDITOR", "VIEWER"];

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      company: { type: "string" },
      role: { type: "string", default: "ADMIN" },
      hours: { type: "string", default: "12" },
      "yes-bypass-sso": { type: "boolean", default: false },
    },
  });

  if (!values["yes-bypass-sso"]) {
    throw new Error(
      "Refusing to mint a session without --yes-bypass-sso. This bypasses Company SSO; " +
        "it is a bootstrap tool for an environment that has no identity provider yet."
    );
  }

  const email = normalizeWorkEmail(values.email ?? null);
  if (!email) throw new Error("--email is required and must be a valid email address.");

  const companyCode = values.company?.trim();
  if (!companyCode) throw new Error("--company <CODE> is required.");

  const role = values.role as UserRole;
  if (!VALID_ROLES.includes(role)) {
    throw new Error(`--role must be one of ${VALID_ROLES.join(", ")}.`);
  }

  const hours = Number(values.hours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 168) {
    throw new Error("--hours must be a positive number no greater than 168 (one week).");
  }

  const prisma = new PrismaClient();
  try {
    const company =
      (await prisma.company.findUnique({ where: { code: companyCode } })) ??
      (await prisma.company.create({
        data: { code: companyCode, name: companyCode },
      }));

    const user =
      (await prisma.user.findFirst({ where: { email, companyId: company.id } })) ??
      (await prisma.user.create({
        data: { email, name: email, companyId: company.id, role, status: "ACTIVE" },
      }));

    // Matches the shape the real OIDC flow produces, so nothing downstream
    // can tell this session apart from a genuine one.
    const existingAccount = await prisma.account.findFirst({ where: { userId: user.id } });
    if (!existingAccount) {
      await prisma.account.create({
        data: {
          userId: user.id,
          type: "oidc",
          provider: "company-sso",
          providerAccountId: `bootstrap-${randomBytes(8).toString("hex")}`,
        },
      });
    }

    const sessionToken = randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + hours * 60 * 60 * 1000);
    await prisma.session.create({ data: { sessionToken, userId: user.id, expires } });

    console.log(`\nSession created for ${email} (${role}) in company ${company.code}.`);
    console.log(`Expires ${expires.toISOString()} — ${hours}h from now.\n`);
    console.log("Set this cookie on the site, then reload:\n");
    console.log("  Name (https):  __Secure-authjs.session-token");
    console.log("  Name (http):   authjs.session-token");
    console.log(`  Value:         ${sessionToken}`);
    console.log("  Path:          /");
    console.log("  Secure:        tick (https only)\n");
    console.log("Revoke early by deleting the row, or by signing out in the app.\n");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
