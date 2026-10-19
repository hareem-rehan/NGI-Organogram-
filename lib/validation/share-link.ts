import { z } from "zod";

import { requestExportSchema } from "@/lib/validation/export";

/** A share token as issued: 32 random bytes, base64url (43 characters). */
export const shareTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "This link is not valid.");

/** Creating a view-only organogram link (docs/DECISIONS.md D60). */
export const createShareLinkSchema = z
  .object({
    label: z.string().trim().max(80, "Keep the label to 80 characters or fewer.").nullish(),
    expiresInDays: z.union([z.literal(7), z.literal(30), z.null()]),
  })
  .strict();

export const revokeShareLinkSchema = z.object({ shareLinkId: z.string().uuid() }).strict();

export const sharedChartSchema = z.object({ token: shareTokenSchema }).strict();

/** A link viewer's export: the same options a signed-in export takes. */
export const sharedExportSchema = z
  .object({ token: shareTokenSchema, options: requestExportSchema })
  .strict();
