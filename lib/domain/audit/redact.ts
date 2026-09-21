import { AUDIT_FIELD_ALLOWLISTS } from "./allowlists";

/**
 * Centralized audit redaction (ADR-0015). Two entry points:
 *
 * - `redactForAudit(entityType, value)` — for a known entity's
 *   before/after snapshot: keeps ONLY the fields on that entity type's
 *   allowlist (lib/domain/audit/allowlists.ts), dropping everything
 *   else, then generically sanitizes what survives.
 * - `sanitizeMetadata(value)` — for free-form `safeMetadata` with no
 *   fixed shape: no allowlist (the caller is trusted server-side code
 *   constructing a small, deliberate object, never raw entity/request
 *   data), but the SAME generic protections still apply.
 *
 * Both are pure and NEVER throw — a redaction edge case (a circular
 * reference, a prototype-pollution key, excessive depth/size) is always
 * handled by truncating/dropping/marking, never by raising an exception
 * that would roll back the mutation the audit event is supposed to
 * document. `undefined`/`null` in, `undefined`/`null` out.
 */

const MAX_DEPTH = 6;
const MAX_SERIALIZED_BYTES = 8 * 1024;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const TRUNCATED_MARKER = "[truncated]";
const CIRCULAR_MARKER = "[circular]";
const MAX_DEPTH_MARKER = "[max-depth]";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
}

function sanitizeValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    return undefined;
  }

  if (depth >= MAX_DEPTH) return MAX_DEPTH_MARKER;

  if (Array.isArray(value)) {
    if (seen.has(value)) return CIRCULAR_MARKER;
    seen.add(value);
    return value.map((item) => sanitizeValue(item, depth + 1, seen));
  }

  if (isPlainObject(value)) {
    if (seen.has(value)) return CIRCULAR_MARKER;
    seen.add(value);
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (DANGEROUS_KEYS.has(key)) continue;
      const sanitized = sanitizeValue(val, depth + 1, seen);
      if (sanitized !== undefined) result[key] = sanitized;
    }
    return result;
  }

  return undefined;
}

function capSerializedSize(value: unknown): unknown {
  let json: string;
  try {
    json = JSON.stringify(value) ?? "null";
  } catch {
    return TRUNCATED_MARKER;
  }
  if (json.length <= MAX_SERIALIZED_BYTES) return value;
  return TRUNCATED_MARKER;
}

/**
 * Keeps only allowlisted top-level fields for `entityType`, drops
 * everything else, then generically sanitizes the survivors. An
 * `entityType` with no registered allowlist yields an empty object
 * (safe by default — nothing is recorded for an entity type nobody
 * explicitly approved) rather than falling back to "keep everything."
 */
export function redactForAudit(entityType: string, value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) return {};

  const allowlist = AUDIT_FIELD_ALLOWLISTS[entityType] ?? [];
  const allowedSet = new Set(allowlist);
  const filtered: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (allowedSet.has(key)) filtered[key] = value[key];
  }

  const sanitized = sanitizeValue(filtered, 0, new WeakSet()) as Record<string, unknown>;
  return capSerializedSize(sanitized) as Record<string, unknown>;
}

/** For free-form `safeMetadata` — no allowlist, but the same generic protections. */
export function sanitizeMetadata(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  const sanitized = sanitizeValue(value, 0, new WeakSet());
  return capSerializedSize(sanitized);
}

/**
 * Field-level diff between two already-redacted snapshots — the field
 * names that differ, not their values (the values are already in
 * `beforeData`/`afterData`; this is a convenience index for the UI/query
 * layer, e.g. "show me every event that changed `status`"). A field
 * present in only one snapshot counts as changed.
 */
export function computeChangedFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): string[] {
  const beforeObj = before ?? {};
  const afterObj = after ?? {};
  const keys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (JSON.stringify(beforeObj[key]) !== JSON.stringify(afterObj[key])) {
      changed.push(key);
    }
  }
  return changed.sort();
}
