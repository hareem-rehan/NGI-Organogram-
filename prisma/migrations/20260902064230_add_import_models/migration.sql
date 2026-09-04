-- CreateEnum
CREATE TYPE "ImportType" AS ENUM ('DEPARTMENT', 'POSITION', 'EMPLOYEE', 'ASSIGNMENT');

-- CreateEnum
CREATE TYPE "ImportMode" AS ENUM ('CREATE_ONLY', 'UPSERT');

-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('UPLOADED', 'VALIDATING', 'VALIDATED', 'VALIDATION_FAILED', 'READY_TO_EXECUTE', 'EXECUTING', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ImportIssueSeverity" AS ENUM ('WARNING', 'ERROR');

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "requestedByUserId" UUID NOT NULL,
    "importType" "ImportType" NOT NULL,
    "importMode" "ImportMode" NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "fileChecksum" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "rawFile" BYTEA,
    "rowPlan" JSONB,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "warningRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "createCount" INTEGER NOT NULL DEFAULT 0,
    "updateCount" INTEGER NOT NULL DEFAULT 0,
    "unchangedCount" INTEGER NOT NULL DEFAULT 0,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'UPLOADED',
    "warningsAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "validatedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_row_issues" (
    "id" UUID NOT NULL,
    "importJobId" UUID NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "field" TEXT,
    "severity" "ImportIssueSeverity" NOT NULL,
    "code" TEXT NOT NULL,
    "safeMessage" TEXT NOT NULL,

    CONSTRAINT "import_row_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_jobs_companyId_createdAt_idx" ON "import_jobs"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "import_jobs_companyId_status_idx" ON "import_jobs"("companyId", "status");

-- CreateIndex
CREATE INDEX "import_jobs_companyId_fileChecksum_idx" ON "import_jobs"("companyId", "fileChecksum");

-- CreateIndex
CREATE INDEX "import_row_issues_importJobId_rowNumber_idx" ON "import_row_issues"("importJobId", "rowNumber");

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_row_issues" ADD CONSTRAINT "import_row_issues_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
