"use client";

import { Maximize, Pencil, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type OrganogramViewMode = "visual" | "outline";
export type OrganogramColorMode = "department" | "family";

interface OrganogramToolbarProps {
  viewMode: OrganogramViewMode;
  onViewModeChange: (mode: OrganogramViewMode) => void;
  colorMode: OrganogramColorMode;
  onColorModeChange: (mode: OrganogramColorMode) => void;
  showPlanned: boolean;
  onShowPlannedChange: (value: boolean) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onFitToView: () => void;
  onResetView: () => void;
  /**
   * Arrange mode (managers only). Off by default so the chart stays a safe,
   * read-only view; on, cards can be dragged to re-parent and gain +/delete/
   * edit controls (docs/DECISIONS.md D21). Only offered in the Visual view.
   */
  canManage: boolean;
  arrangeMode: boolean;
  onArrangeModeChange: (value: boolean) => void;
}

export function OrganogramToolbar({
  viewMode,
  onViewModeChange,
  colorMode,
  onColorModeChange,
  showPlanned,
  onShowPlannedChange,
  onExpandAll,
  onCollapseAll,
  onFitToView,
  onResetView,
  canManage,
  arrangeMode,
  onArrangeModeChange,
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

          {canManage ? (
            <Button
              type="button"
              size="sm"
              variant={arrangeMode ? "default" : "outline"}
              aria-pressed={arrangeMode}
              onClick={() => onArrangeModeChange(!arrangeMode)}
            >
              <Pencil aria-hidden="true" className="size-4" />
              {arrangeMode ? "Arranging" : "Arrange"}
            </Button>
          ) : null}

          <div className="bg-border mx-1 h-6 w-px" aria-hidden="true" />

          <div
            role="group"
            aria-label="Colour by"
            className="border-border flex items-center rounded-md border p-0.5"
          >
            <span className="text-muted-foreground px-2 text-xs">Colour by</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-pressed={colorMode === "department"}
              className={cn(colorMode === "department" && "bg-accent")}
              onClick={() => onColorModeChange("department")}
            >
              Department
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-pressed={colorMode === "family"}
              className={cn(colorMode === "family" && "bg-accent")}
              onClick={() => onColorModeChange("family")}
            >
              Sub-division
            </Button>
          </div>
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
