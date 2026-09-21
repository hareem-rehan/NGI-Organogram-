import "server-only";
import type { CareerTrack, JobFamily, LevelMappingEntry } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import type { DbClient } from "@/lib/repositories/types";

// ── Job family ────────────────────────────────────────────────────────

export async function listJobFamiliesForCompany(
  companyId: string,
  db: DbClient = prisma
): Promise<JobFamily[]> {
  return db.jobFamily.findMany({
    where: { companyId },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });
}

export async function listJobFamiliesForDepartment(
  departmentId: string,
  companyId: string,
  db: DbClient = prisma
): Promise<JobFamily[]> {
  return db.jobFamily.findMany({
    where: { departmentId, companyId },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });
}

export async function findJobFamilyById(
  id: string,
  companyId: string,
  db: DbClient = prisma
): Promise<JobFamily | null> {
  return db.jobFamily.findFirst({ where: { id, companyId } });
}

export async function countPositionsInJobFamily(
  jobFamilyId: string,
  companyId: string,
  db: DbClient = prisma
): Promise<number> {
  return db.position.count({ where: { jobFamilyId, companyId } });
}

// ── Career track ──────────────────────────────────────────────────────

export async function listCareerTracksForCompany(
  companyId: string,
  db: DbClient = prisma
): Promise<CareerTrack[]> {
  return db.careerTrack.findMany({
    where: { companyId },
    orderBy: [{ displayOrder: "asc" }, { kind: "asc" }],
  });
}

export async function listCareerTracksForFamily(
  jobFamilyId: string,
  companyId: string,
  db: DbClient = prisma
): Promise<CareerTrack[]> {
  return db.careerTrack.findMany({
    where: { jobFamilyId, companyId },
    orderBy: [{ displayOrder: "asc" }, { kind: "asc" }],
  });
}

export async function findCareerTrackById(
  id: string,
  companyId: string,
  db: DbClient = prisma
): Promise<CareerTrack | null> {
  return db.careerTrack.findFirst({ where: { id, companyId } });
}

export async function countPositionsInCareerTrack(
  careerTrackId: string,
  companyId: string,
  db: DbClient = prisma
): Promise<number> {
  return db.position.count({ where: { careerTrackId, companyId } });
}

// ── Level-mapping entry ───────────────────────────────────────────────

export async function listLevelMappingEntriesForCompany(
  companyId: string,
  db: DbClient = prisma
): Promise<LevelMappingEntry[]> {
  return db.levelMappingEntry.findMany({
    where: { companyId },
    orderBy: [{ displayOrder: "asc" }, { title: "asc" }],
  });
}

export async function findLevelMappingEntryById(
  id: string,
  companyId: string,
  db: DbClient = prisma
): Promise<LevelMappingEntry | null> {
  return db.levelMappingEntry.findFirst({ where: { id, companyId } });
}

/**
 * The eligible position titles for a specific matrix cell — used by the
 * Position form to filter/validate the title field for a chosen (family,
 * track, level). Reporting is never consulted here.
 */
export async function findLevelMappingEntriesForCell(
  params: { companyId: string; jobFamilyId: string; careerTrackId: string; jobGradeId: string },
  db: DbClient = prisma
): Promise<LevelMappingEntry[]> {
  return db.levelMappingEntry.findMany({
    where: {
      companyId: params.companyId,
      jobFamilyId: params.jobFamilyId,
      careerTrackId: params.careerTrackId,
      jobGradeId: params.jobGradeId,
    },
    orderBy: [{ displayOrder: "asc" }, { title: "asc" }],
  });
}
