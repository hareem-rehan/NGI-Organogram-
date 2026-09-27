-- CreateTable
CREATE TABLE "department_level_titles" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "jobGradeCode" TEXT NOT NULL,
    "kind" "CareerTrackKind" NOT NULL,
    "title" TEXT NOT NULL,
    "displayOrder" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "department_level_titles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "department_level_titles_companyId_idx" ON "department_level_titles"("companyId");

-- CreateIndex
CREATE INDEX "department_level_titles_departmentId_idx" ON "department_level_titles"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "department_level_titles_companyId_departmentId_kind_jobGrad_key" ON "department_level_titles"("companyId", "departmentId", "kind", "jobGradeCode", "title");

-- AddForeignKey
ALTER TABLE "department_level_titles" ADD CONSTRAINT "department_level_titles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_level_titles" ADD CONSTRAINT "department_level_titles_departmentId_companyId_fkey" FOREIGN KEY ("departmentId", "companyId") REFERENCES "departments"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
