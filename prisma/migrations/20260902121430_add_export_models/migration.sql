-- CreateEnum
CREATE TYPE "ExportFormat" AS ENUM ('PDF', 'PNG');

-- CreateEnum
CREATE TYPE "ExportScope" AS ENUM ('FULL_COMPANY', 'CURRENT_VIEW', 'POSITION_FOCUS', 'DEPARTMENT_FOCUS');

-- CreateEnum
CREATE TYPE "ExportJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "requestedByUserId" UUID NOT NULL,
    "format" "ExportFormat" NOT NULL,
    "scope" "ExportScope" NOT NULL,
    "optionsSnapshot" JSONB NOT NULL,
    "scopeLabel" TEXT NOT NULL,
    "nodeCount" INTEGER NOT NULL DEFAULT 0,
    "status" "ExportJobStatus" NOT NULL DEFAULT 'QUEUED',
    "generatedFile" BYTEA,
    "generatedFilename" TEXT,
    "fileSize" INTEGER,
    "pageCount" INTEGER,
    "errorMessage" TEXT,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "export_jobs_companyId_createdAt_idx" ON "export_jobs"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "export_jobs_companyId_status_idx" ON "export_jobs"("companyId", "status");

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
