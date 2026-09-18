/**
 * Pure organogram search (Phase 9, docs/ORGANOGRAM_SEARCH_AND_FOCUS.md).
 * Operates entirely on the `OrganogramNode[]` array the existing
 * `organogram:view`-gated action already returned — no second network
 * request, no new server endpoint, no raw SQL anywhere near this file.
 * Company scoping and authorization are therefore satisfied by
 * construction: this function can only ever see data the caller was
 * already authorized to fetch.
 */
import type { OccupancyStatus, OrganogramNode, PositionStatus } from "@/lib/domain/organogram";

export const SEARCH_MIN_QUERY_LENGTH = 2;
export const SEARCH_MAX_QUERY_LENGTH = 100;
export const SEARCH_MAX_RESULTS = 20;

export type SearchMatchType = "positionCode" | "title" | "occupant" | "department";

export interface OrganogramSearchResult {
  positionId: string;
  title: string;
  positionCode: string;
  /** null means Vacant — a vacant position is still fully searchable by title/code. */
  occupantDisplayName: string | null;
  departmentName: string;
  departmentCode: string;
  organizationalLevel: number;
  positionStatus: PositionStatus;
  occupancyStatus: OccupancyStatus;
  matchType: SearchMatchType;
  isExactMatch: boolean;
}

/** Trims, collapses internal whitespace, and hard-caps length — applied before length-checking or matching, never after. */
export function normalizeSearchQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, SEARCH_MAX_QUERY_LENGTH);
}

const MATCH_TYPE_RANK: Record<SearchMatchType, number> = {
  positionCode: 0,
  title: 1,
  occupant: 2,
  department: 3,
};

/**
 * Approved search fields only: position title, position code, occupant
 * display name (never a raw employee record/code — docs/DECISIONS.md),
 * department name, department code. Case-insensitive substring match;
 * exact matches rank above partial matches of any field, and within each
 * tier position-code beats title beats occupant beats department —
 * deterministic given the same input (docs/ORGANOGRAM_SEARCH_AND_FOCUS.md
 * "Ranking").
 */
export function searchOrganogramNodes(
  nodes: readonly OrganogramNode[],
  rawQuery: string,
  options: { showPlanned?: boolean } = {}
): OrganogramSearchResult[] {
  const query = normalizeSearchQuery(rawQuery);
  if (query.length < SEARCH_MIN_QUERY_LENGTH) return [];
  const showPlanned = options.showPlanned ?? true;
  const needle = query.toLowerCase();

  interface Candidate {
    node: OrganogramNode;
    matchType: SearchMatchType;
    isExact: boolean;
  }
  const candidates: Candidate[] = [];

  for (const node of nodes) {
    if (!showPlanned && node.isPlanned) continue;

    const codeLower = node.positionCode.toLowerCase();
    const titleLower = node.title.toLowerCase();
    const occupantLower = node.occupantDisplayName?.toLowerCase() ?? null;
    const deptNameLower = node.departmentName.toLowerCase();
    const deptCodeLower = node.departmentCode.toLowerCase();

    let matchType: SearchMatchType | null = null;
    let isExact = false;

    if (codeLower === needle) {
      matchType = "positionCode";
      isExact = true;
    } else if (titleLower === needle) {
      matchType = "title";
      isExact = true;
    } else if (occupantLower === needle) {
      matchType = "occupant";
      isExact = true;
    } else if (deptNameLower === needle || deptCodeLower === needle) {
      matchType = "department";
      isExact = true;
    } else if (codeLower.includes(needle)) {
      matchType = "positionCode";
    } else if (titleLower.includes(needle)) {
      matchType = "title";
    } else if (occupantLower?.includes(needle)) {
      matchType = "occupant";
    } else if (deptNameLower.includes(needle) || deptCodeLower.includes(needle)) {
      matchType = "department";
    }

    if (matchType) candidates.push({ node, matchType, isExact });
  }

  candidates.sort((a, b) => {
    if (a.isExact !== b.isExact) return a.isExact ? -1 : 1;
    const typeDiff = MATCH_TYPE_RANK[a.matchType] - MATCH_TYPE_RANK[b.matchType];
    if (typeDiff !== 0) return typeDiff;
    return (
      a.node.organizationalLevel - b.node.organizationalLevel ||
      a.node.title.localeCompare(b.node.title) ||
      a.node.positionCode.localeCompare(b.node.positionCode)
    );
  });

  return candidates.slice(0, SEARCH_MAX_RESULTS).map((c): OrganogramSearchResult => ({
    positionId: c.node.positionId,
    title: c.node.title,
    positionCode: c.node.positionCode,
    occupantDisplayName: c.node.occupantDisplayName,
    departmentName: c.node.departmentName,
    departmentCode: c.node.departmentCode,
    organizationalLevel: c.node.organizationalLevel,
    positionStatus: c.node.positionStatus,
    occupancyStatus: c.node.occupancyStatus,
    matchType: c.matchType,
    isExactMatch: c.isExact,
  }));
}
