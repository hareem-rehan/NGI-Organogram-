import { z } from "zod";

import { CARD_NODE_KEY_PATTERN } from "@/lib/domain/organogram-card-offsets";

/**
 * Server-side validation for HR-placed organogram cards (docs/DECISIONS.md
 * D38). `companyId` is never a field — it comes from the session only.
 */

const nodeKeySchema = z.string().regex(CARD_NODE_KEY_PATTERN, "Unknown chart card.");
/** Generous but bounded, so a stray value can never fling a card off into space. */
const offsetSchema = z.number().finite().min(-50_000).max(50_000);

export const saveCardOffsetSchema = z
  .object({ nodeKey: nodeKeySchema, dx: offsetSchema, dy: offsetSchema })
  .strict();
export type SaveCardOffsetValues = z.infer<typeof saveCardOffsetSchema>;

/** Clear the given cards' offsets (e.g. after a card is re-attached elsewhere). */
export const clearCardOffsetsSchema = z
  .object({ nodeKeys: z.array(nodeKeySchema).min(1).max(1000) })
  .strict();
