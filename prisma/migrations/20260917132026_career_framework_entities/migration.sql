-- CreateEnum
CREATE TYPE "CareerTrackKind" AS ENUM ('IC', 'MANAGER');

-- AlterEnum
ALTER TYPE "AuditCategory" ADD VALUE 'CAREER_FRAMEWORK';

-- AlterTable
ALTER TABLE "positions" ADD COLUMN     "careerTrackId" UUID,
ADD COLUMN     "jobFamilyId" UUID;

-- CreateTable
CREATE TABLE "job_families" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "displayOrder" INTEGER,
    "status" "DepartmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "career_tracks" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "jobFamilyId" UUID NOT NULL,
    "kind" "CareerTrackKind" NOT NULL,
    "name" TEXT NOT NULL,
    "displayOrder" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "career_tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "level_mapping_entries" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "jobFamilyId" UUID NOT NULL,
    "careerTrackId" UUID NOT NULL,
    "jobGradeId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "displayOrder" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "level_mapping_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_families_companyId_idx" ON "job_families"("companyId");

-- CreateIndex
CREATE INDEX "job_families_departmentId_idx" ON "job_families"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "job_families_companyId_code_key" ON "job_families"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "job_families_id_companyId_key" ON "job_families"("id", "companyId");

-- CreateIndex
CREATE INDEX "career_tracks_companyId_idx" ON "career_tracks"("companyId");

-- CreateIndex
CREATE INDEX "career_tracks_jobFamilyId_idx" ON "career_tracks"("jobFamilyId");

-- CreateIndex
CREATE UNIQUE INDEX "career_tracks_companyId_jobFamilyId_kind_key" ON "career_tracks"("companyId", "jobFamilyId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "career_tracks_id_companyId_key" ON "career_tracks"("id", "companyId");

-- CreateIndex
CREATE INDEX "level_mapping_entries_companyId_idx" ON "level_mapping_entries"("companyId");

-- CreateIndex
CREATE INDEX "level_mapping_entries_jobFamilyId_idx" ON "level_mapping_entries"("jobFamilyId");

-- CreateIndex
CREATE INDEX "level_mapping_entries_careerTrackId_idx" ON "level_mapping_entries"("careerTrackId");

-- CreateIndex
CREATE INDEX "level_mapping_entries_jobGradeId_idx" ON "level_mapping_entries"("jobGradeId");

-- CreateIndex
CREATE UNIQUE INDEX "level_mapping_entries_companyId_jobFamilyId_careerTrackId_j_key" ON "level_mapping_entries"("companyId", "jobFamilyId", "careerTrackId", "jobGradeId", "title");

-- CreateIndex
CREATE INDEX "positions_jobFamilyId_idx" ON "positions"("jobFamilyId");

-- CreateIndex
CREATE INDEX "positions_careerTrackId_idx" ON "positions"("careerTrackId");

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_jobFamilyId_companyId_fkey" FOREIGN KEY ("jobFamilyId", "companyId") REFERENCES "job_families"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_careerTrackId_companyId_fkey" FOREIGN KEY ("careerTrackId", "companyId") REFERENCES "career_tracks"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_families" ADD CONSTRAINT "job_families_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_families" ADD CONSTRAINT "job_families_departmentId_companyId_fkey" FOREIGN KEY ("departmentId", "companyId") REFERENCES "departments"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_tracks" ADD CONSTRAINT "career_tracks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_tracks" ADD CONSTRAINT "career_tracks_jobFamilyId_companyId_fkey" FOREIGN KEY ("jobFamilyId", "companyId") REFERENCES "job_families"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "level_mapping_entries" ADD CONSTRAINT "level_mapping_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "level_mapping_entries" ADD CONSTRAINT "level_mapping_entries_jobFamilyId_companyId_fkey" FOREIGN KEY ("jobFamilyId", "companyId") REFERENCES "job_families"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "level_mapping_entries" ADD CONSTRAINT "level_mapping_entries_careerTrackId_companyId_fkey" FOREIGN KEY ("careerTrackId", "companyId") REFERENCES "career_tracks"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "level_mapping_entries" ADD CONSTRAINT "level_mapping_entries_jobGradeId_companyId_fkey" FOREIGN KEY ("jobGradeId", "companyId") REFERENCES "job_grades"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
