-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "DepartmentStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "JobGradeStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PositionStatus" AS ENUM ('PLANNED', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'TRANSFERRED', 'TERMINATED');

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "code" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "parentDepartmentId" UUID,
    "status" "DepartmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "displayOrder" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_grades" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "displayOrder" INTEGER,
    "status" "JobGradeStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "jobGradeId" UUID,
    "title" TEXT NOT NULL,
    "positionCode" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "status" "PositionStatus" NOT NULL DEFAULT 'ACTIVE',
    "primaryReportsToPositionId" UUID,
    "organizationalLevel" INTEGER NOT NULL,
    "displayOrder" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "preferredName" TEXT,
    "workEmail" TEXT,
    "employmentStatus" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "joiningDate" DATE,
    "leavingDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "position_assignments" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "positionId" UUID NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "position_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_code_key" ON "companies"("code");

-- CreateIndex
CREATE INDEX "departments_companyId_idx" ON "departments"("companyId");

-- CreateIndex
CREATE INDEX "departments_parentDepartmentId_idx" ON "departments"("parentDepartmentId");

-- CreateIndex
CREATE UNIQUE INDEX "departments_companyId_code_key" ON "departments"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "departments_id_companyId_key" ON "departments"("id", "companyId");

-- CreateIndex
CREATE INDEX "job_grades_companyId_idx" ON "job_grades"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "job_grades_companyId_code_key" ON "job_grades"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "job_grades_id_companyId_key" ON "job_grades"("id", "companyId");

-- CreateIndex
CREATE INDEX "positions_companyId_idx" ON "positions"("companyId");

-- CreateIndex
CREATE INDEX "positions_departmentId_idx" ON "positions"("departmentId");

-- CreateIndex
CREATE INDEX "positions_jobGradeId_idx" ON "positions"("jobGradeId");

-- CreateIndex
CREATE INDEX "positions_primaryReportsToPositionId_idx" ON "positions"("primaryReportsToPositionId");

-- CreateIndex
CREATE INDEX "positions_companyId_organizationalLevel_idx" ON "positions"("companyId", "organizationalLevel");

-- CreateIndex
CREATE UNIQUE INDEX "positions_companyId_positionCode_key" ON "positions"("companyId", "positionCode");

-- CreateIndex
CREATE UNIQUE INDEX "positions_id_companyId_key" ON "positions"("id", "companyId");

-- CreateIndex
CREATE INDEX "employees_companyId_idx" ON "employees"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "employees_companyId_employeeCode_key" ON "employees"("companyId", "employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "employees_companyId_workEmail_key" ON "employees"("companyId", "workEmail");

-- CreateIndex
CREATE UNIQUE INDEX "employees_id_companyId_key" ON "employees"("id", "companyId");

-- CreateIndex
CREATE INDEX "position_assignments_companyId_idx" ON "position_assignments"("companyId");

-- CreateIndex
CREATE INDEX "position_assignments_employeeId_idx" ON "position_assignments"("employeeId");

-- CreateIndex
CREATE INDEX "position_assignments_positionId_idx" ON "position_assignments"("positionId");

-- CreateIndex
CREATE INDEX "position_assignments_positionId_isPrimary_endDate_idx" ON "position_assignments"("positionId", "isPrimary", "endDate");

-- CreateIndex
CREATE INDEX "position_assignments_employeeId_isPrimary_endDate_idx" ON "position_assignments"("employeeId", "isPrimary", "endDate");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_parentDepartmentId_companyId_fkey" FOREIGN KEY ("parentDepartmentId", "companyId") REFERENCES "departments"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_grades" ADD CONSTRAINT "job_grades_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_departmentId_companyId_fkey" FOREIGN KEY ("departmentId", "companyId") REFERENCES "departments"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_jobGradeId_companyId_fkey" FOREIGN KEY ("jobGradeId", "companyId") REFERENCES "job_grades"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_primaryReportsToPositionId_companyId_fkey" FOREIGN KEY ("primaryReportsToPositionId", "companyId") REFERENCES "positions"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_assignments" ADD CONSTRAINT "position_assignments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_assignments" ADD CONSTRAINT "position_assignments_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_assignments" ADD CONSTRAINT "position_assignments_positionId_companyId_fkey" FOREIGN KEY ("positionId", "companyId") REFERENCES "positions"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-authored additions (docs/DOMAIN_MODEL.md §7 documents each rule's
-- enforcement layer). Prisma's schema DSL cannot express these directly:
--   1. "A position must not report to itself" (self-referential CHECK).
--   2. "A department must not be its own parent" (self-referential CHECK).
--   3. "endDate must not be earlier than startDate."
--   4. Concurrency-safe "at most one open-ended active primary occupant
--      per position" / "...primary position per employee" — a PARTIAL
--      UNIQUE INDEX, which rejects the second of two concurrent inserts
--      at the database level (not just app-level check-then-insert,
--      which has a race condition).
--   5. Concurrency-safe "at most one root position per company" — same
--      partial-unique-index technique.
-- =====================================================================

-- CheckConstraint: a position cannot report to itself
ALTER TABLE "positions"
  ADD CONSTRAINT "positions_no_self_report"
  CHECK ("primaryReportsToPositionId" IS NULL OR "primaryReportsToPositionId" <> "id");

-- CheckConstraint: a department cannot be its own parent
ALTER TABLE "departments"
  ADD CONSTRAINT "departments_no_self_parent"
  CHECK ("parentDepartmentId" IS NULL OR "parentDepartmentId" <> "id");

-- CheckConstraint: an assignment's end date cannot precede its start date
ALTER TABLE "position_assignments"
  ADD CONSTRAINT "position_assignments_end_after_start"
  CHECK ("endDate" IS NULL OR "endDate" >= "startDate");

-- Partial unique index: at most one open-ended (endDate IS NULL) primary
-- assignment per position at any time — this IS the "position vacancy"
-- concurrency guard (docs/DOMAIN_MODEL.md §4, §6).
CREATE UNIQUE INDEX "position_assignments_one_open_primary_per_position"
  ON "position_assignments" ("positionId")
  WHERE "isPrimary" = true AND "endDate" IS NULL;

-- Partial unique index: at most one open-ended primary assignment per
-- employee at any time — "one active primary position per employee."
CREATE UNIQUE INDEX "position_assignments_one_open_primary_per_employee"
  ON "position_assignments" ("employeeId")
  WHERE "isPrimary" = true AND "endDate" IS NULL;

-- Partial unique index: at most one root position (no primary parent)
-- per company at any time. Prevents two concurrent "create the root"
-- calls from both succeeding, and prevents a move from ever creating a
-- second root.
CREATE UNIQUE INDEX "positions_one_root_per_company"
  ON "positions" ("companyId")
  WHERE "primaryReportsToPositionId" IS NULL;
