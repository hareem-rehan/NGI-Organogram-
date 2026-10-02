import type { OrganogramNode } from "@/lib/domain/organogram";
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
export function organogramCardSize(node: OrganogramNode, style: TextStyle | undefined): CardSize {
  const isHeading = node.kind === "department" || node.kind === "subdivision";
  return cardSizeFor(
    {
      kind: node.kind,
      title: node.title,
      departmentName: node.departmentName,
      occupantName: node.occupancyStatus === "occupied" ? node.occupantDisplayName : null,
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
