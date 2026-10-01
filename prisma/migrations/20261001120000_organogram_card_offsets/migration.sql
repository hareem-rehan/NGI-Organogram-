-- Organogram card offsets: HR-dragged card positions (docs/DECISIONS.md D38).
-- CreateTable
CREATE TABLE "organogram_card_offsets" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "nodeKey" TEXT NOT NULL,
    "dx" DOUBLE PRECISION NOT NULL,
    "dy" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organogram_card_offsets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "organogram_card_offsets_companyId_idx" ON "organogram_card_offsets"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "organogram_card_offsets_companyId_nodeKey_key" ON "organogram_card_offsets"("companyId", "nodeKey");

-- AddForeignKey
ALTER TABLE "organogram_card_offsets" ADD CONSTRAINT "organogram_card_offsets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

