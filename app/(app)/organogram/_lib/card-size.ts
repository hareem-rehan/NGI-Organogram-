import type { OrganogramNode } from "@/lib/domain/organogram";
import { occupantCardView, occupantNamesOf } from "@/lib/domain/organogram-occupants";
import { cardSizeFor, type CardSize } from "@/lib/domain/organogram-card-size";
import type { TextStyle } from "@/lib/domain/organogram-text-style";

/** Width of a "Planned" / "Inactive" badge beside a title, plus its gap. */
const STATUS_BADGE_WIDTH = 66;

/**
 * A chart card's natural size (D47) from what position-node.tsx draws on it.
 * Search badges (Match / Context) are left out on purpose: they come and go
 * with a search, and must not re-lay the chart out; the title truncates
 * instead.
 */
export function organogramCardSize(
  node: OrganogramNode,
  style: TextStyle | undefined,
  /** The card's names are expanded on screen (user request, 2026-10-19). */
  namesExpanded = false
): CardSize {
  const view = occupantCardView(occupantNamesOf(node), namesExpanded);
  const isHeading = node.kind === "department" || node.kind === "subdivision";
  return cardSizeFor(
    {
      kind: node.kind,
      title: node.title,
      departmentName: node.departmentName,
      occupantName: node.occupancyStatus === "occupied" ? node.occupantDisplayName : null,
      occupantLines: view.names.length + (view.toggle ? 1 : 0),
      expandedOccupantNames: namesExpanded && view.toggle ? view.names : undefined,
      roleCount: isHeading
        ? (node.departmentMemberCount ?? node.displayChildCount ?? node.directReportCount)
        : (node.totalReportCount ?? node.displayChildCount ?? node.directReportCount),
      hasChildren: node.hasChildren,
      jobGradeCode: node.jobGradeCode,
      jobFamilyName: node.jobFamilyName,
      badgeWidth: node.positionStatus !== "ACTIVE" ? STATUS_BADGE_WIDTH : 0,
    },
    style
  );
}
