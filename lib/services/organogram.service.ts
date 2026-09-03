import "server-only";

import { findCompanyById } from "@/lib/repositories/company.repository";
import { getOrganogramRawData } from "@/lib/repositories/organogram.repository";
import {
  analyzeOrganogramSafety,
  buildOrganogramGraph,
  type OrganogramEdge,
  type OrganogramNode,
} from "@/lib/domain/organogram";
import { NotFoundError } from "@/lib/domain/errors";

export interface OrganogramCompanySummary {
  name: string;
  code: string;
  /** ISO date (YYYY-MM-DD) — the effective date occupancy was computed as of. */
  effectiveDate: string;
}

export interface OrganogramSafetySummary {
  /** False only when the company has zero positions, or every position is unreachable from a root. */
  hasRoot: boolean;
  /** Always 0 under the current schema (DB partial unique index) — kept for forward-compatibility, same as docs/DASHBOARD_METRICS.md §H. */
  extraRootCount: number;
  /** Positions excluded from `nodes`/`edges` because their reporting chain forms a cycle. */
  cyclePositionCount: number;
  /** Positions excluded from `nodes`/`edges` because their reporting chain cannot reach the root (dangling parent). */
  disconnectedPositionCount: number;
}

/**
 * The full, whitelisted organogram data contract
 * (docs/ORGANOGRAM_RENDERING.md "Hierarchy Data Contract"). `nodes`/`edges`
 * cover the ENTIRE company hierarchy — expand/collapse is a pure
 * client-side filter over this one payload, never a second request per
 * node. No salary, contact, address, SSO/auth, or other confidential HR
 * field is present on `OrganogramNode` by construction (no such field
 * exists on the type) — only an occupant's display name, never the raw
 * Employee record.
 */
export interface OrganogramData {
  company: OrganogramCompanySummary;
  nodes: OrganogramNode[];
  edges: OrganogramEdge[];
  safety: OrganogramSafetySummary;
}

export interface GetOrganogramDataInput {
  companyId: string;
  /** Injectable for deterministic tests; defaults to the real current time. */
  now?: Date;
}

/**
 * Assembles the read-only organogram payload. A cycle or a disconnected
 * position is isolated (excluded from `nodes`/`edges`, counted in
 * `safety`) rather than rendered with a fabricated relationship or
 * allowed to hang the traversal — see
 * .claude/skills/organogram-hierarchy-safety/SKILL.md.
 */
export async function getOrganogramData(input: GetOrganogramDataInput): Promise<OrganogramData> {
  const now = input.now ?? new Date();
  const { companyId } = input;

  const company = await findCompanyById(companyId);
  if (!company) throw new NotFoundError("Company", companyId);

  const raw = await getOrganogramRawData(companyId, now);

  const safety = analyzeOrganogramSafety(
    raw.positions.map((p) => ({
      id: p.id,
      status: p.status,
      primaryReportsToPositionId: p.primaryReportsToPositionId,
    }))
  );

  const departmentsById = new Map(raw.departments.map((d) => [d.id, d]));
  const { nodes, edges } = buildOrganogramGraph({
    positions: raw.positions,
    safePositionIds: safety.safePositionIds,
    departmentsById,
    jobGradeNamesById: raw.jobGradeNamesById,
    occupantNamesByPositionId: raw.occupantNamesByPositionId,
    occupantEmployeeIdsByPositionId: raw.occupantEmployeeIdsByPositionId,
  });

  return {
    company: {
      name: company.name,
      code: company.code,
      effectiveDate: now.toISOString().slice(0, 10),
    },
    nodes,
    edges,
    safety: {
      hasRoot: safety.rootPositionId !== null,
      extraRootCount: safety.extraRootIds.length,
      cyclePositionCount: safety.cyclePositionIds.length,
      disconnectedPositionCount: safety.disconnectedPositionIds.length,
    },
  };
}
