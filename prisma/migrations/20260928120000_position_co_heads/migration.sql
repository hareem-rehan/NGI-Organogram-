-- Co-heads (docs/DECISIONS.md D27): a position may report to at most TWO
-- heads. Head 1 stays in "primaryReportsToPositionId"; head 2 is this new,
-- optional column. Company-scoped composite FK, same shape as head 1.

-- AlterTable
ALTER TABLE "positions" ADD COLUMN     "coReportsToPositionId" UUID;

-- CreateIndex
CREATE INDEX "positions_coReportsToPositionId_idx" ON "positions"("coReportsToPositionId");

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_coReportsToPositionId_companyId_fkey" FOREIGN KEY ("coReportsToPositionId", "companyId") REFERENCES "positions"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rules Prisma's schema language cannot express (defence in depth — the
-- service layer, lib/services/hierarchy.service.ts, enforces them first):
--   1. Head 2 is never the position itself.
--   2. Head 2 is never the same position as head 1.
--   3. The root (no head 1) never has a head 2.
ALTER TABLE "positions" ADD CONSTRAINT "positions_co_reports_to_not_self"
  CHECK ("coReportsToPositionId" IS NULL OR "coReportsToPositionId" <> "id");

ALTER TABLE "positions" ADD CONSTRAINT "positions_co_reports_to_not_primary"
  CHECK ("coReportsToPositionId" IS NULL OR "coReportsToPositionId" <> "primaryReportsToPositionId");

ALTER TABLE "positions" ADD CONSTRAINT "positions_co_reports_to_requires_primary"
  CHECK ("coReportsToPositionId" IS NULL OR "primaryReportsToPositionId" IS NOT NULL);
