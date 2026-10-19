-- View-only organogram share links (docs/DECISIONS.md D60).
CREATE TABLE "organogram_share_links" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "label" TEXT,
    "createdByUserId" UUID,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastExportAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organogram_share_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organogram_share_links_token_key" ON "organogram_share_links"("token");
CREATE INDEX "organogram_share_links_companyId_idx" ON "organogram_share_links"("companyId");

ALTER TABLE "organogram_share_links" ADD CONSTRAINT "organogram_share_links_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
