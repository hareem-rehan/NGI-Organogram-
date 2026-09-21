"use client";

import { Maximize, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type OrganogramViewMode = "visual" | "outline";

interface OrganogramToolbarProps {
  viewMode: OrganogramViewMode;
  onViewModeChange: (mode: OrganogramViewMode) => void;
  showPlanned: boolean;
  onShowPlannedChange: (value: boolean) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onFitToView: () => void;
  onResetView: () => void;
}

export function OrganogramToolbar({
  viewMode,
  onViewModeChange,
  showPlanned,
  onShowPlannedChange,
  onExpandAll,
  onCollapseAll,
  onFitToView,
  onResetView,
}: OrganogramToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b pb-3">
      <div
        role="group"
        aria-label="View mode"
        className="border-border flex rounded-md border p-0.5"
      >
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-pressed={viewMode === "visual"}
          className={cn(viewMode === "visual" && "bg-accent")}
          onClick={() => onViewModeChange("visual")}
        >
          Visual View
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-pressed={viewMode === "outline"}
          className={cn(viewMode === "outline" && "bg-accent")}
          onClick={() => onViewModeChange("outline")}
        >
          Outline View
        </Button>
      </div>

      <div className="bg-border mx-1 h-6 w-px" aria-hidden="true" />

      <Button type="button" size="sm" variant="outline" onClick={onExpandAll}>
        Expand All
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={onCollapseAll}>
        Collapse All
      </Button>

      {viewMode === "visual" ? (
        <>
          <Button type="button" size="sm" variant="outline" onClick={onFitToView}>
            <Maximize aria-hidden="true" className="size-4" />
            Fit to View
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onResetView}>
            <RefreshCw aria-hidden="true" className="size-4" />
            Reset View
          </Button>
        </>
      ) : null}

      <div className="bg-border mx-1 h-6 w-px" aria-hidden="true" />

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={showPlanned}
          onChange={(event) => onShowPlannedChange(event.target.checked)}
          className="accent-primary size-4"
        />
        Show planned positions
      </label>
    </div>
  );
}
