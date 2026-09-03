import { z } from "zod";

/**
 * Shared pagination/search primitives reused by every list schema
 * (departments, positions, employees, assignment history). Bounded page
 * size prevents an "unlimited records" query regardless of what a
 * client requests (Phase 6 Step 11 requirement).
 */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const MAX_SEARCH_LENGTH = 100;

export const pageSchema = z.coerce.number().int().min(1).catch(1);
export const pageSizeSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(MAX_PAGE_SIZE)
  .catch(DEFAULT_PAGE_SIZE);
export const searchQuerySchema = z.string().trim().max(MAX_SEARCH_LENGTH).optional();
