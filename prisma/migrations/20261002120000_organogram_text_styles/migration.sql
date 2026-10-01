-- Organogram text styles: chart-wide and per-card font settings (docs/DECISIONS.md D41).
-- CreateTable
CREATE TABLE "organogram_text_styles" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "nodeKey" TEXT NOT NULL,
    "fontFamily" TEXT,
    "fontSize" INTEGER,
    "color" TEXT,
    "bold" BOOLEAN,
    "italic" BOOLEAN,
    "underline" BOOLEAN,
    "strikethrough" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organogram_text_styles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "organogram_text_styles_companyId_idx" ON "organogram_text_styles"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "organogram_text_styles_companyId_nodeKey_key" ON "organogram_text_styles"("companyId", "nodeKey");

-- AddForeignKey
ALTER TABLE "organogram_text_styles" ADD CONSTRAINT "organogram_text_styles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

