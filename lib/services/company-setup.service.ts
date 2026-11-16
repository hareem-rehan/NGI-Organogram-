import "server-only";
import type { Company } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { ConflictError } from "@/lib/domain/errors";
import type { DbClient } from "@/lib/repositories/types";
import { createCompanySchema } from "@/lib/validation/settings";

/**
 * Creates the company record a fresh database needs (D71). A new database
 * starts empty, the seed refuses to run outside development/test, and
 * `create-admin` needs an existing company, so without this a production
 * environment could never get its first admin. Only reached from the
 * provisioning CLI (scripts/provision-user.ts), never from the web app.
 * Company settings are created lazily on first use, as for any company.
 */
export async function createCompany(input: unknown, db: DbClient = prisma): Promise<Company> {
  const values = createCompanySchema.parse(input);
  const existing = await db.company.findUnique({ where: { code: values.code } });
  if (existing) {
    throw new ConflictError(`A company with code "${values.code}" already exists.`);
  }
  return db.company.create({
    data: {
      code: values.code,
      name: values.name,
      legalName: values.legalName ?? null,
      timezone: values.timezone,
      status: "ACTIVE",
    },
  });
}
