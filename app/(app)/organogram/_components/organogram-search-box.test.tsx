import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { OrganogramSearchBox } from "./organogram-search-box";
import type { OrganogramNode } from "@/lib/domain/organogram";

function node(overrides: Partial<OrganogramNode> & { positionId: string }): OrganogramNode {
  return {
    positionCode: `POS-${overrides.positionId}`,
    title: `Title ${overrides.positionId}`,
    departmentId: "dept-1",
    departmentName: "Engineering",
    departmentCode: "ENG",
    departmentColor: "#16a34a",
    jobGradeId: null,
    jobGradeName: null,
    organizationalLevel: 1,
    positionStatus: "ACTIVE",
    occupancyStatus: "vacant",
    occupantDisplayName: null,
    occupantEmployeeId: null,
    directReportCount: 0,
    primaryReportsToPositionId: null,
    hasChildren: false,
    isPlanned: false,
    isActive: true,
    ...overrides,
  };
}

const NODES: OrganogramNode[] = [
  node({ positionId: "a", title: "VP Engineering" }),
  node({ positionId: "b", title: "VP Sales" }),
];

// Interactions that open the underlying Radix Popover (typing into the
// combobox, viewing results, selecting an option, the Clear button, and
// the aria-live result-count announcement) are deliberately NOT covered
// here. As already documented in
// app/(app)/positions/_components/position-move-dialog.test.tsx, opening
// components/ui/combobox.tsx's Popover hangs indefinitely in this
// project's jsdom test environment regardless of how the interaction is
// triggered (mouse or keyboard) — a pre-existing, already-investigated
// limitation, not something introduced by this component. Those
// behaviors are covered instead by:
//   - lib/domain/organogram-search.test.ts (min/max length, ranking,
//     planned-visibility, no-match cases — the pure search logic itself)
//   - e2e/organogram-search-and-focus.spec.ts (real-browser coverage of
//     typing, result selection, Clear Search, keyboard-only search, and
//     the aria-live announcement under axe in e2e/accessibility.spec.ts)
describe("OrganogramSearchBox", () => {
  it("renders a closed combobox with the search placeholder and no Clear button", () => {
    render(<OrganogramSearchBox nodes={NODES} showPlanned={true} onSelectResult={vi.fn()} />);
    expect(
      screen.getByRole("combobox", { name: /search the organization chart/i })
    ).toHaveAttribute("placeholder", "Search by name, title, code, or department…");
    expect(screen.queryByRole("button", { name: /clear search/i })).not.toBeInTheDocument();
  });
});
