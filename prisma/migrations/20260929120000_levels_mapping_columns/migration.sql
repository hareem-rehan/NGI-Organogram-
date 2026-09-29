-- Levels Mapping show/hide columns + sub-division level titles (docs/DECISIONS.md D34).
-- AlterTable
ALTER TABLE "departments" ADD COLUMN     "showInLevelsMapping" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "job_families" ADD COLUMN     "showInLevelsMapping" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "job_family_level_titles" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "jobFamilyId" UUID NOT NULL,
    "jobGradeCode" TEXT NOT NULL,
    "kind" "CareerTrackKind" NOT NULL,
    "title" TEXT NOT NULL,
    "displayOrder" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_family_level_titles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_family_level_titles_companyId_idx" ON "job_family_level_titles"("companyId");

-- CreateIndex
CREATE INDEX "job_family_level_titles_jobFamilyId_idx" ON "job_family_level_titles"("jobFamilyId");

-- CreateIndex
CREATE UNIQUE INDEX "job_family_level_titles_companyId_jobFamilyId_kind_jobGrade_key" ON "job_family_level_titles"("companyId", "jobFamilyId", "kind", "jobGradeCode", "title");

-- AddForeignKey
ALTER TABLE "job_family_level_titles" ADD CONSTRAINT "job_family_level_titles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_family_level_titles" ADD CONSTRAINT "job_family_level_titles_jobFamilyId_companyId_fkey" FOREIGN KEY ("jobFamilyId", "companyId") REFERENCES "job_families"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;


-- Keep today's columns: every department that has a ladder was shown before.
UPDATE "departments" SET "showInLevelsMapping" = true WHERE "hasIcLadder" OR "hasManagerLadder";
