/**
 * What the Add Position form is pre-filled with when + is clicked on an
 * organogram card (user request, 2026-10-02). The new position reports to
 * the position one level above where + was clicked, in the same department
 * or sub-division:
 *
 *   - a position card: its department and sub-division; reports to that card;
 *   - a sub-division box: its department and sub-division; reports to the
 *     position the box hangs under;
 *   - a department box: its department; reports to the manager of the
 *     department's most senior position (the position directly above the
 *     department), else the nearest position above the box on the chart.
 *
 * Level is never pre-filled. Pure: no DB, no React.
 */

export interface PrefillPosition {
  id: string;
  departmentId: string;
  primaryReportsToPositionId: string | null;
  organizationalLevel: number;
  title: string;
}

export interface PrefillCard {
  positionId: string;
  kind?: "position" | "department" | "subdivision";
  departmentId: string;
  jobFamilyId: string | null;
  primaryReportsToPositionId: string | null;
}

export interface AddPositionPrefill {
  departmentId: string;
  reportsToPositionId: string | null;
  jobFamilyId: string | null;
}

/**
 * The department's most senior position(s): members whose manager is
 * outside the department (or who have none). Lowest level first, then title.
 */
function departmentTop(
  departmentId: string,
  positions: readonly PrefillPosition[]
): PrefillPosition | null {
  const members = positions.filter((p) => p.departmentId === departmentId);
  const memberIds = new Set(members.map((p) => p.id));
  const tops = members
    .filter((p) => !p.primaryReportsToPositionId || !memberIds.has(p.primaryReportsToPositionId))
    .sort(
      (a, b) => a.organizationalLevel - b.organizationalLevel || a.title.localeCompare(b.title)
    );
  return tops[0] ?? null;
}

export function addPositionPrefill(
  card: PrefillCard,
  /** Every chart card, to walk up from a box to the nearest real position. */
  chartCards: readonly PrefillCard[],
  /** Every position in the company (the real reporting data). */
  positions: readonly PrefillPosition[]
): AddPositionPrefill {
  const kind = card.kind ?? "position";
  if (kind === "position") {
    return {
      departmentId: card.departmentId,
      reportsToPositionId: card.positionId,
      jobFamilyId: card.jobFamilyId,
    };
  }

  const nearestPositionAbove = (): string | null => {
    const byId = new Map(chartCards.map((c) => [c.positionId, c]));
    const seen = new Set<string>();
    let current = card.primaryReportsToPositionId;
    while (current && !seen.has(current)) {
      seen.add(current);
      const above = byId.get(current);
      if (!above) return current; // not drawn as a card, but a real id
      if ((above.kind ?? "position") === "position") return above.positionId;
      current = above.primaryReportsToPositionId;
    }
    return null;
  };

  if (kind === "subdivision") {
    return {
      departmentId: card.departmentId,
      reportsToPositionId: nearestPositionAbove(),
      jobFamilyId: card.jobFamilyId,
    };
  }

  const top = departmentTop(card.departmentId, positions);
  return {
    departmentId: card.departmentId,
    reportsToPositionId: top ? (top.primaryReportsToPositionId ?? top.id) : nearestPositionAbove(),
    jobFamilyId: null,
  };
}
