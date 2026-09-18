/**
 * Secure, server-side-only CLI for user provisioning (Phase 3). This is
 * the ONLY way to grant ADMIN or HR_EDITOR — no SSO claim, auto-
 * provisioning path, or web UI can ever assign those roles (see
 * lib/services/user.service.ts and docs/AUTHORIZATION_MATRIX.md).
 *
 * No password is ever accepted or stored — this tool only manages who a
 * verified Company SSO identity is allowed to become once they sign in.
 *
 * Usage:
 *   npm run auth:provision -- create-admin --email <email> --company <code>
 *   npm run auth:provision -- add --email <email> --role <ADMIN|HR_EDITOR|VIEWER> --company <code>
 *   npm run auth:provision -- set-role --email <email> --role <ADMIN|HR_EDITOR|VIEWER>
 *   npm run auth:provision -- disable --email <email>
 *   npm run auth:provision -- enable --email <email>
 *   npm run auth:provision -- list [--company <code>]
 *
 * In a production NODE_ENV, every mutating command additionally requires
 * `--yes-i-am-sure-this-is-production` — see assertProductionSafe below.
 */
import { parseArgs } from "node:util";
import { PrismaClient, type UserRole } from "@prisma/client";

import { normalizeWorkEmail } from "../lib/domain/normalize";

const VALID_ROLES: readonly UserRole[] = ["ADMIN", "HR_EDITOR", "VIEWER"];

function isValidRole(value: string | undefined): value is UserRole {
  return typeof value === "string" && (VALID_ROLES as readonly string[]).includes(value);
}

function requireEmail(value: string | undefined): string {
  const normalized = normalizeWorkEmail(value ?? null);
  if (!normalized) {
    throw new UsageError("--email is required and must be a valid, non-empty email address.");
  }
  return normalized;
}

class UsageError extends Error {}

function assertProductionSafe(confirmed: boolean): void {
  if (process.env.NODE_ENV === "production" && !confirmed) {
    throw new UsageError(
      "Refusing to run a mutating provisioning command against NODE_ENV=production without " +
        "the explicit --yes-i-am-sure-this-is-production flag. This is not a default you can " +
        "accidentally trigger."
    );
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      email: { type: "string" },
      role: { type: "string" },
      company: { type: "string" },
      "yes-i-am-sure-this-is-production": { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const prisma = new PrismaClient();
  try {
    switch (command) {
      case "create-admin": {
        assertProductionSafe(values["yes-i-am-sure-this-is-production"]);
        const email = requireEmail(values.email);
        if (!values.company) throw new UsageError("--company (company code) is required.");
        const company = await prisma.company.findUnique({ where: { code: values.company } });
        if (!company) throw new UsageError(`No company found with code "${values.company}".`);

        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
          throw new UsageError(
            `A user with email "${email}" already exists (role: ${existing.role}, status: ${existing.status}). Use set-role/enable instead.`
          );
        }

        const user = await prisma.user.create({
          data: { email, companyId: company.id, role: "ADMIN", status: "ACTIVE" },
        });
        printUser("Created ADMIN", user);
        break;
      }

      case "add": {
        assertProductionSafe(values["yes-i-am-sure-this-is-production"]);
        const email = requireEmail(values.email);
        if (!isValidRole(values.role)) {
          throw new UsageError(`--role must be one of: ${VALID_ROLES.join(", ")}`);
        }
        if (!values.company) throw new UsageError("--company (company code) is required.");
        const company = await prisma.company.findUnique({ where: { code: values.company } });
        if (!company) throw new UsageError(`No company found with code "${values.company}".`);

        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
          throw new UsageError(`A user with email "${email}" already exists.`);
        }

        const user = await prisma.user.create({
          data: { email, companyId: company.id, role: values.role, status: "ACTIVE" },
        });
        printUser(`Created ${values.role}`, user);
        break;
      }

      case "set-role": {
        assertProductionSafe(values["yes-i-am-sure-this-is-production"]);
        const email = requireEmail(values.email);
        if (!isValidRole(values.role)) {
          throw new UsageError(`--role must be one of: ${VALID_ROLES.join(", ")}`);
        }
        const user = await prisma.user.update({
          where: { email },
          data: { role: values.role },
        });
        printUser("Updated role", user);
        break;
      }

      case "disable": {
        assertProductionSafe(values["yes-i-am-sure-this-is-production"]);
        const email = requireEmail(values.email);
        const user = await prisma.user.update({ where: { email }, data: { status: "DISABLED" } });
        printUser("Disabled", user);
        break;
      }

      case "enable": {
        assertProductionSafe(values["yes-i-am-sure-this-is-production"]);
        const email = requireEmail(values.email);
        const user = await prisma.user.update({ where: { email }, data: { status: "ACTIVE" } });
        printUser("Enabled", user);
        break;
      }

      case "list": {
        const users = await prisma.user.findMany({
          where: values.company ? { company: { code: values.company } } : undefined,
          orderBy: { email: "asc" },
        });
        // Deliberately prints only non-sensitive fields — no provider
        // tokens exist on User at all, but this stays explicit about
        // what's safe to print if the model ever grows a sensitive field.
        for (const user of users) {
          console.log(`${user.email}\t${user.role}\t${user.status}\t${user.companyId}`);
        }
        console.log(`\n${users.length} user(s).`);
        break;
      }

      default:
        throw new UsageError(
          "Usage: create-admin | add | set-role | disable | enable | list (see file header for flags)."
        );
    }
  } finally {
    await prisma.$disconnect();
  }
}

function printUser(label: string, user: { email: string; role: string; status: string }): void {
  console.log(`${label}: ${user.email} (role=${user.role}, status=${user.status})`);
}

main().catch((error: unknown) => {
  if (error instanceof UsageError) {
    console.error(`Error: ${error.message}`);
  } else {
    console.error("Unexpected error:", error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});
