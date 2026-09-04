/**
 * Validates a raw URL search-param value against an allowed literal set,
 * returning the matched value or `fallback` — used to seed a list view's
 * initial filter state from a dashboard deep link (e.g. `?status=ACTIVE`)
 * without ever trusting an arbitrary query string directly (Phase 7's
 * "validate all URL parameters on destination pages").
 */
export function parseEnumParam<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  fallback: T
): T {
  if (raw !== null && (allowed as readonly string[]).includes(raw)) return raw as T;
  return fallback;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Same intent as parseEnumParam, for a UUID-shaped id param (e.g. `?department=<id>`) — a malformed value falls back to "no filter" rather than reaching the server action at all. */
export function parseUuidParam(raw: string | null): string {
  if (raw !== null && UUID_PATTERN.test(raw)) return raw;
  return "";
}

/** Max entries kept from a single comma-separated list param — deliberately generous for real usage, small enough to reject an adversarial/malformed URL outright rather than partially process it (Phase 9's "reject excessive parameter counts"). */
const MAX_LIST_PARAM_ENTRIES = 50;
/** Max raw characters read from a single param value before parsing — a URL-length defense independent of how many entries it claims to contain. */
const MAX_PARAM_RAW_LENGTH = 2000;

/**
 * Comma-separated list of UUID-shaped values (e.g. `?departments=<id>,<id>`).
 * Non-UUID entries are silently dropped (not the whole param) — one typo'd
 * id shouldn't discard every other valid one. An oversized raw string or
 * an excessive entry count is treated as fully invalid (returns `[]`)
 * rather than partially honored, since that shape is more consistent
 * with a malformed/adversarial URL than a genuine multi-select.
 */
export function parseUuidListParam(raw: string | null): string[] {
  if (raw === null || raw.length === 0 || raw.length > MAX_PARAM_RAW_LENGTH) return [];
  const parts = raw.split(",");
  if (parts.length > MAX_LIST_PARAM_ENTRIES) return [];
  const seen = new Set<string>();
  for (const part of parts) {
    if (UUID_PATTERN.test(part)) seen.add(part.toLowerCase());
  }
  return [...seen];
}

/**
 * Comma-separated list of integers within `[min, max]` — same
 * drop-invalid-entries-not-the-whole-param and oversized-input rules as
 * {@link parseUuidListParam}.
 */
export function parseIntListParam(raw: string | null, min: number, max: number): number[] {
  if (raw === null || raw.length === 0 || raw.length > MAX_PARAM_RAW_LENGTH) return [];
  const parts = raw.split(",");
  if (parts.length > MAX_LIST_PARAM_ENTRIES) return [];
  const seen = new Set<number>();
  for (const part of parts) {
    if (!/^-?\d+$/.test(part)) continue;
    const n = Number(part);
    if (Number.isInteger(n) && n >= min && n <= max) seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}

/** `"true"`/`"false"` only — anything else (including absence) falls back to `fallback`, never a truthy-string coercion footgun. */
export function parseBooleanParam(raw: string | null, fallback: boolean): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}
