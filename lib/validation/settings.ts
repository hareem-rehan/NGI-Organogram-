import { z } from "zod";

/**
 * Server-side validation for company-settings actions. `.strict()` on
 * every schema below is what rejects an unknown key (e.g. a client
 * attempting to submit `clientSecret` or `companyId`) before it ever
 * reaches `lib/services/settings.service.ts` — the service's own typed
 * input additionally has no field for either, so this is defense in
 * depth, not the only guard.
 */
export const updateCompanyProfileSchema = z
  .object({
    name: z.string().trim().min(1, "Company name is required.").max(150).optional(),
    legalName: z.string().trim().max(200).nullable().optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
    expectedUpdatedAt: z.coerce.date().optional(),
  })
  .strict();

export const updateSettingsSchema = z
  .object({
    brandingText: z.string().trim().max(200).nullable().optional(),
    defaultExpansionDepth: z.number().int().min(1).max(10).optional(),
    defaultViewMode: z.enum(["visual", "outline"]).optional(),
    showPlannedByDefault: z.boolean().optional(),
    defaultPdfPageSize: z.enum(["A4", "A3"]).optional(),
    defaultPdfLayoutMode: z.enum(["AUTO", "SINGLE_PAGE", "MULTI_PAGE_TILED"]).optional(),
    defaultPngScale: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    includeLegendByDefault: z.boolean().optional(),
    includeConfidentialityLabelByDefault: z.boolean().optional(),
    exportRetentionDays: z.number().int().min(1).max(30).optional(),
    expectedUpdatedAt: z.coerce.date().optional(),
  })
  .strict();
