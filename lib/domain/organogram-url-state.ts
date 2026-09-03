/**
 * Deep-link / URL-state contract for Phase 9 search, filters, and focus
 * (docs/ORGANOGRAM_SEARCH_AND_FOCUS.md "URL-State Contract"). Pure
 * parse/serialize functions — no Next.js import, so they're unit-testable
 * with a plain `URLSearchParams` and reusable from both the client
 * component and any future test harness.
 *
 * Privacy: this contract carries ONLY stable ids and enum values —
 * never a name, work email, free-text search query, companyId, or auth
 * data (docs/DECISIONS.md, this phase's own Step 10 requirement).
 * `positionId`/`departmentId` are already-opaque UUIDs; a cross-company
 * id here can never resolve to real data, since the client never has
 * another company's data to look up in the first place (Phase 8's
 * company-scoped fetch).
 */
import {
  parseBooleanParam,
  parseEnumParam,
  parseIntListParam,
  parseUuidListParam,
  parseUuidParam,
} from "@/lib/utils/search-params";
import type { OccupancyFilter, OrganogramFilterState } from "@/lib/domain/organogram-filters";
import type { DescendantDepth } from "@/lib/domain/organogram-focus";
import type { PositionStatus } from "@/lib/domain/organogram";

export type FocusViewMode = "full" | "position" | "department";
export type DisplayMode = "visual" | "outline";

export interface OrganogramUrlState {
  view: FocusViewMode;
  /** Position Focus target — meaningful only when view === "position". */
  positionId: string | null;
  /** Department Focus target — meaningful only when view === "department". */
  departmentId: string | null;
  depth: DescendantDepth;
  filters: OrganogramFilterState;
  planned: boolean;
  display: DisplayMode;
}

const VIEW_MODES: readonly FocusViewMode[] = ["full", "position", "department"];
const DISPLAY_MODES: readonly DisplayMode[] = ["visual", "outline"];
const OCCUPANCY_VALUES: readonly OccupancyFilter[] = ["all", "occupied", "vacant"];
const STATUS_VALUES: readonly PositionStatus[] = ["PLANNED", "ACTIVE", "INACTIVE"];
const DEPTH_VALUES: readonly string[] = ["1", "2", "3", "all"];
/** Sentinel for "Not Assigned" (Position.jobGradeId IS NULL) inside the `grades` param — never a real UUID, so it can't collide with an actual grade id. */
const NOT_ASSIGNED_GRADE_TOKEN = "none";

function parseDepth(raw: string | null): DescendantDepth {
  const value = parseEnumParam(raw, DEPTH_VALUES, "2");
  return value === "all" ? "all" : (Number(value) as 1 | 2 | 3);
}

function parseGradeIds(raw: string | null): Set<string | null> {
  const ids = new Set<string | null>();
  if (raw !== null && raw.length > 0 && raw.length <= 2000) {
    const parts = raw.split(",");
    if (parts.length <= 50) {
      for (const part of parts) {
        if (part === NOT_ASSIGNED_GRADE_TOKEN) ids.add(null);
        else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(part))
          ids.add(part.toLowerCase());
      }
    }
  }
  return ids;
}

function parseStatuses(raw: string | null): Set<PositionStatus> {
  const statuses = new Set<PositionStatus>();
  if (raw !== null && raw.length > 0 && raw.length <= 200) {
    for (const part of raw.split(",").slice(0, 10)) {
      if ((STATUS_VALUES as readonly string[]).includes(part)) statuses.add(part as PositionStatus);
    }
  }
  return statuses;
}

/**
 * Parses a `URLSearchParams` into a fully-validated `OrganogramUrlState`.
 * Every field has a safe default — an invalid, malicious, or merely
 * unrecognized value NEVER throws and NEVER passes through unvalidated;
 * it silently falls back, exactly like Phase 7's `parseEnumParam`/
 * `parseUuidParam` pattern this reuses and extends. A `position`/
 * `department` param that isn't UUID-shaped becomes `null` (not an
 * empty-string sentinel), matching the "missing/inaccessible" safe-state
 * contract `lib/domain/organogram-focus.ts` already implements.
 */
export function parseOrganogramUrlState(params: URLSearchParams): OrganogramUrlState {
  const view = parseEnumParam(params.get("view"), VIEW_MODES, "full");
  const positionIdRaw = parseUuidParam(params.get("position"));
  const departmentIdRaw = parseUuidParam(params.get("department"));

  return {
    view,
    positionId: view === "position" && positionIdRaw !== "" ? positionIdRaw : null,
    departmentId: view === "department" && departmentIdRaw !== "" ? departmentIdRaw : null,
    depth: parseDepth(params.get("depth")),
    filters: {
      departmentIds: new Set(parseUuidListParam(params.get("departments"))),
      levels: new Set(parseIntListParam(params.get("levels"), 1, 200)),
      jobGradeIds: parseGradeIds(params.get("grades")),
      occupancy: parseEnumParam(params.get("occupancy"), OCCUPANCY_VALUES, "all"),
      statuses: parseStatuses(params.get("statuses")),
    },
    planned: parseBooleanParam(params.get("planned"), true),
    display: parseEnumParam(params.get("display"), DISPLAY_MODES, "visual"),
  };
}

/**
 * Serializes state back to `URLSearchParams`, omitting any field at its
 * default value — keeps a "Copy View Link" URL as short as possible
 * while still round-tripping exactly through `parseOrganogramUrlState`.
 * Never includes a field not in this contract (no query text, no
 * personal data — see this file's own header comment).
 */
export function serializeOrganogramUrlState(state: OrganogramUrlState): URLSearchParams {
  const params = new URLSearchParams();

  if (state.view !== "full") params.set("view", state.view);
  if (state.view === "position" && state.positionId) params.set("position", state.positionId);
  if (state.view === "department" && state.departmentId)
    params.set("department", state.departmentId);
  if (state.view === "position" && state.depth !== 2) params.set("depth", String(state.depth));

  if (state.filters.departmentIds.size > 0) {
    params.set("departments", [...state.filters.departmentIds].sort().join(","));
  }
  if (state.filters.levels.size > 0) {
    params.set(
      "levels",
      [...state.filters.levels]
        .sort((a, b) => a - b)
        .map(String)
        .join(",")
    );
  }
  if (state.filters.jobGradeIds.size > 0) {
    params.set(
      "grades",
      [...state.filters.jobGradeIds]
        .map((id) => id ?? NOT_ASSIGNED_GRADE_TOKEN)
        .sort()
        .join(",")
    );
  }
  if (state.filters.occupancy !== "all") params.set("occupancy", state.filters.occupancy);
  if (state.filters.statuses.size > 0) {
    params.set("statuses", [...state.filters.statuses].sort().join(","));
  }

  if (!state.planned) params.set("planned", "false");
  if (state.display !== "visual") params.set("display", state.display);

  return params;
}

export function defaultOrganogramUrlState(): OrganogramUrlState {
  return parseOrganogramUrlState(new URLSearchParams());
}
