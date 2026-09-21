-- Levels (job grades) can now belong to a department, so a code like "L7"
-- can carry a different NAME per department while its numeric rank stays
-- universal. departmentId NULL keeps the legacy company-wide scope (how
-- the seed and imports create grades).

-- AlterTable: add the nullable department scope.
ALTER TABLE "job_grades" ADD COLUMN "departmentId" UUID;

-- Compound FK to the department, company-scoped (matches every other
-- cross-entity FK in this schema), RESTRICT so a department in use by a
-- level cannot be deleted out from under it.
ALTER TABLE "job_grades"
  ADD CONSTRAINT "job_grades_departmentId_companyId_fkey"
  FOREIGN KEY ("departmentId", "companyId")
  REFERENCES "departments"("id", "companyId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Replace the old company-wide unique with a per-(department, code) one.
DROP INDEX "job_grades_companyId_code_key";
CREATE UNIQUE INDEX "job_grades_companyId_departmentId_code_key"
  ON "job_grades"("companyId", "departmentId", "code");

-- Postgres treats NULLs as distinct in a unique index, so the index above
-- does NOT keep company-wide (NULL-department) grades unique. This partial
-- index does — the same hand-authored-partial-unique-index pattern this
-- schema already uses for positions_one_root_per_company.
CREATE UNIQUE INDEX "job_grades_companyId_code_shared_key"
  ON "job_grades"("companyId", "code")
  WHERE "departmentId" IS NULL;

-- Index the new FK column.
CREATE INDEX "job_grades_departmentId_idx" ON "job_grades"("departmentId");
