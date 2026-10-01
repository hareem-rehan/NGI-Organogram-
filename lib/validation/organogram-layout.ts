import { z } from "zod";

import { CARD_NODE_KEY_PATTERN } from "@/lib/domain/organogram-card-offsets";
import {
  CHART_STYLE_KEY,
  FONT_FAMILY_IDS,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
} from "@/lib/domain/organogram-text-style";

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

// ── Text styles (D41) ───────────────────────────────────────────────────

/** "chart" (every card) or one card's node key. */
const styleKeySchema = z.union([z.literal(CHART_STYLE_KEY), nodeKeySchema]);

export const textStyleSchema = z
  .object({
    fontFamily: z.enum(FONT_FAMILY_IDS).nullable().optional(),
    fontSize: z.number().int().min(MIN_FONT_SIZE).max(MAX_FONT_SIZE).nullable().optional(),
    color: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i, "Colour must be #rrggbb.")
      .nullable()
      .optional(),
    bold: z.boolean().nullable().optional(),
    italic: z.boolean().nullable().optional(),
    underline: z.boolean().nullable().optional(),
    strikethrough: z.boolean().nullable().optional(),
  })
  .strict();

export const saveTextStyleSchema = z
  .object({ nodeKey: styleKeySchema, style: textStyleSchema })
  .strict();

export const clearTextStyleSchema = z.object({ nodeKey: styleKeySchema }).strict();
