/**
 * One-off local convenience: copy the CURRENT staging org data into the LOCAL
 * dev database, re-homed under the DEV-LOCAL company, so `localhost:3000` shows
 * exactly what staging shows. Read-only on staging. Kept for the handoff (docs/HANDOFF.md); not part of
 * the app. Run with:
 *   NODE_ENV=development npx tsx scripts/copy-staging-to-local.ts
 *
 * Staging credentials are read from .vercel/.env.production.local (DATABASE_URL);
 * the local target comes from the root .env (localhost).
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

function isPostgresUrl(v: string): boolean {
  return v.startsWith("postgres://") || v.startsWith("postgresql://");
}

function readStagingUrl(): string {
  // Preferred: pass the staging/Supabase connection string explicitly, e.g.
  //   STAGING_DATABASE_URL='postgres://…' NODE_ENV=development npx tsx scripts/copy-staging-to-local.ts
  const fromEnv = process.env.STAGING_DATABASE_URL?.trim();
  if (fromEnv) {
    if (!isPostgresUrl(fromEnv)) {
      throw new Error(
        `STAGING_DATABASE_URL is not a Postgres URL (it starts with "${fromEnv.slice(0, 12)}…"). ` +
          `Replace the placeholder with the REAL connection string — copy the DATABASE_URL value from ` +
          `Vercel → dotzero-organogram → Settings → Environment Variables (or Supabase → Settings → Database → ` +
          `Connection string). It must start with postgres:// or postgresql://.`
      );
    }
    return fromEnv;
  }
  // Fallback: .vercel/.env.production.local — but Vercel Secrets are NOT stored
  // there in plaintext (they come back as "[SENSITIVE]" placeholders), so this
  // only works if the value happens to be a real URL.
  try {
    const raw = readFileSync(".vercel/.env.production.local", "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^DATABASE_URL=(.*)$/);
      if (m?.[1]) {
        const val = m[1].trim().replace(/^["']|["']$/g, "");
        if (val.includes("://")) return val;
      }
    }
  } catch {
    /* fall through to the explicit error */
  }
  throw new Error(
    "No staging database URL. Set STAGING_DATABASE_URL to your Supabase connection string (the DATABASE_URL from Vercel → Project → Settings → Environment Variables), then re-run."
  );
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run against production.");

  const staging = new PrismaClient({ datasources: { db: { url: readStagingUrl() } } });
  const local = new PrismaClient(); // root .env → localhost

  try {
    // Pick the staging company to mirror. If there is more than one, take the
    // one with the most positions (the real working org).
    const companies = await staging.company.findMany();
    if (companies.length === 0) throw new Error("No company found on staging.");
    let source = companies[0]!;
    if (companies.length > 1) {
      const counts = await Promise.all(
        companies.map(async (c) => ({
          c,
          n: await staging.position.count({ where: { companyId: c.id } }),
        }))
      );
      source = counts.sort((a, b) => b.n - a.n)[0]!.c;
    }
    const srcId = source.id;
    console.log(`Source staging company: ${source.name} (${source.code})`);

    // Read every org-scoped table for that company.
    const [
      settings,
      departments,
      jobGrades,
      jobFamilies,
      careerTracks,
      levelMappingEntries,
      positions,
      employees,
      assignments,
      departmentLevelTitles,
      jobFamilyLevelTitles,
      cardOffsets,
      textStyles,
    ] = await Promise.all([
      staging.companySettings.findFirst({ where: { companyId: srcId } }),
      staging.department.findMany({ where: { companyId: srcId } }),
      staging.jobGrade.findMany({ where: { companyId: srcId } }),
      staging.jobFamily.findMany({ where: { companyId: srcId } }),
      staging.careerTrack.findMany({ where: { companyId: srcId } }),
      staging.levelMappingEntry.findMany({ where: { companyId: srcId } }),
      staging.position.findMany({ where: { companyId: srcId } }),
      staging.employee.findMany({ where: { companyId: srcId } }),
      staging.positionAssignment.findMany({ where: { companyId: srcId } }),
      // Newer tables (Levels Mapping names D26/D34, card positions D38, text styles D41).
      staging.departmentLevelTitle.findMany({ where: { companyId: srcId } }),
      staging.jobFamilyLevelTitle.findMany({ where: { companyId: srcId } }),
      staging.organogramCardOffset.findMany({ where: { companyId: srcId } }),
      staging.organogramTextStyle.findMany({ where: { companyId: srcId } }),
    ]);

    // Target: the local DEV-LOCAL company (so dev-sign-in maps to it). Re-home
    // every copied row onto this company id; internal ids/FKs are preserved, so
    // the whole graph stays consistent under one uniform companyId.
    const localCompany = await local.company.upsert({
      where: { code: "DEV-LOCAL" },
      update: { name: source.name },
      create: { name: source.name, code: "DEV-LOCAL" },
    });
    const dstId = localCompany.id;
    const rehome = <T extends { companyId: string }>(row: T): T => ({ ...row, companyId: dstId });

    // Clean slate for this company's org data (child → parent order).
    await local.organogramCardOffset.deleteMany({ where: { companyId: dstId } });
    await local.organogramTextStyle.deleteMany({ where: { companyId: dstId } });
    await local.departmentLevelTitle.deleteMany({ where: { companyId: dstId } });
    await local.jobFamilyLevelTitle.deleteMany({ where: { companyId: dstId } });
    await local.positionAssignment.deleteMany({ where: { companyId: dstId } });
    await local.position.deleteMany({ where: { companyId: dstId } });
    await local.levelMappingEntry.deleteMany({ where: { companyId: dstId } });
    await local.careerTrack.deleteMany({ where: { companyId: dstId } });
    await local.jobFamily.deleteMany({ where: { companyId: dstId } });
    await local.jobGrade.deleteMany({ where: { companyId: dstId } });
    await local.employee.deleteMany({ where: { companyId: dstId } });
    await local.department.deleteMany({ where: { companyId: dstId } });

    if (settings) {
      const { id: _id, companyId: _c, ...rest } = settings;
      await local.companySettings.upsert({
        where: { companyId: dstId },
        update: rest,
        create: { ...rest, companyId: dstId },
      });
    }

    // Departments: insert parents before children (self-FK).
    const deptById = new Map(departments.map((d) => [d.id, d]));
    const insertedDept = new Set<string>();
    const canInsertDept = (d: (typeof departments)[number]) =>
      !d.parentDepartmentId ||
      insertedDept.has(d.parentDepartmentId) ||
      !deptById.has(d.parentDepartmentId);
    let remaining = [...departments];
    while (remaining.length) {
      const ready = remaining.filter(canInsertDept);
      if (ready.length === 0) throw new Error("Department cycle detected.");
      for (const d of ready) {
        await local.department.create({ data: rehome(d) });
        insertedDept.add(d.id);
      }
      remaining = remaining.filter((d) => !insertedDept.has(d.id));
    }

    await local.jobGrade.createMany({ data: jobGrades.map(rehome) });
    await local.jobFamily.createMany({ data: jobFamilies.map(rehome) });
    await local.careerTrack.createMany({ data: careerTracks.map(rehome) });
    await local.levelMappingEntry.createMany({ data: levelMappingEntries.map(rehome) });
    await local.employee.createMany({ data: employees.map(rehome) });

    // Positions: insert shallow → deep so primaryReportsToPositionId resolves.
    for (const p of [...positions].sort((a, b) => a.organizationalLevel - b.organizationalLevel)) {
      await local.position.create({ data: rehome(p) });
    }

    await local.positionAssignment.createMany({ data: assignments.map(rehome) });
    await local.departmentLevelTitle.createMany({ data: departmentLevelTitles.map(rehome) });
    await local.jobFamilyLevelTitle.createMany({ data: jobFamilyLevelTitles.map(rehome) });
    await local.organogramCardOffset.createMany({ data: cardOffsets.map(rehome) });
    await local.organogramTextStyle.createMany({ data: textStyles.map(rehome) });

    console.log(
      `Copied into DEV-LOCAL: ${departments.length} departments, ${positions.length} positions, ` +
        `${jobGrades.length} levels, ${jobFamilies.length} sub-divisions, ${careerTracks.length} tracks, ` +
        `${levelMappingEntries.length} titles, ${employees.length} employees, ${assignments.length} assignments, ` +
        `${departmentLevelTitles.length + jobFamilyLevelTitles.length} level names, ` +
        `${cardOffsets.length} placed cards, ${textStyles.length} text styles.`
    );
  } finally {
    await staging.$disconnect();
    await local.$disconnect();
  }
}

main().catch((e) => {
  console.error("copy-staging-to-local failed:", e);
  process.exit(1);
});
