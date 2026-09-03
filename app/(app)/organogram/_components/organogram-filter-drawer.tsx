"use client";

import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { OrganogramFilterPanel } from "@/app/(app)/organogram/_components/organogram-filter-panel";
import { isAnyFilterActive, type OrganogramFilterState } from "@/lib/domain/organogram-filters";
import type { OrganogramNode } from "@/lib/domain/organogram";

interface OrganogramFilterDrawerProps {
  nodes: readonly OrganogramNode[];
  filters: OrganogramFilterState;
  onFiltersChange: (filters: OrganogramFilterState) => void;
  matchCount: number;
}

function countActiveFilters(filters: OrganogramFilterState): number {
  return (
    filters.departmentIds.size +
    filters.levels.size +
    filters.jobGradeIds.size +
    filters.statuses.size +
    (filters.occupancy !== "all" ? 1 : 0)
  );
}

/**
 * One drawer implementation for every viewport (reusing the same `Sheet`
 * primitive `components/layout/mobile-nav.tsx` already uses) rather than
 * a separate always-open desktop sidebar plus a distinct mobile drawer —
 * a deliberate scope simplification, documented in
 * docs/ORGANOGRAM_SEARCH_AND_FOCUS.md "Known Limitations."
 */
export function OrganogramFilterDrawer({
  nodes,
  filters,
  onFiltersChange,
  matchCount,
}: OrganogramFilterDrawerProps) {
  const [open, setOpen] = useState(false);
  const activeCount = countActiveFilters(filters);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <SlidersHorizontal aria-hidden="true" className="size-4" />
          Filters
          {isAnyFilterActive(filters) ? (
            <Badge variant="default" className="ml-1">
              {activeCount}
            </Badge>
          ) : null}
        </Button>
      </SheetTrigger>
      <SheetContent
        title="Filters"
        description="Narrow the organization chart by department, level, job grade, occupancy, and status."
      >
        <div className="mt-4 overflow-y-auto">
          <OrganogramFilterPanel
            nodes={nodes}
            filters={filters}
            onFiltersChange={onFiltersChange}
            matchCount={matchCount}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
