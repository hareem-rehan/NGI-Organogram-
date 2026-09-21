"use client";

import { useState } from "react";
import { ArrowLeft, Check, Link as LinkIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { DescendantDepth } from "@/lib/domain/organogram-focus";
import type { FocusViewMode } from "@/lib/domain/organogram-url-state";

interface OrganogramFocusBarProps {
  view: FocusViewMode;
  focusLabel: string | null;
  depth: DescendantDepth;
  onDepthChange: (depth: DescendantDepth) => void;
  onReturnToFullView: () => void;
  onCopyLink: () => Promise<boolean>;
}

const DEPTH_OPTIONS: { value: string; label: string }[] = [
  { value: "1", label: "Direct Reports Only" },
  { value: "2", label: "Two Levels" },
  { value: "3", label: "Three Levels" },
  { value: "all", label: "All Descendants" },
];

/** Shown only when a Focus mode (Position or Department) is active — Full Company View has no focus bar at all. */
export function OrganogramFocusBar({
  view,
  focusLabel,
  depth,
  onDepthChange,
  onReturnToFullView,
  onCopyLink,
}: OrganogramFocusBarProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  async function handleCopy() {
    const ok = await onCopyLink();
    setCopyState(ok ? "copied" : "failed");
    setTimeout(() => setCopyState("idle"), 2000);
  }

  return (
    <div className="bg-accent/40 flex flex-wrap items-center gap-2 rounded-md px-3 py-2 text-sm">
      <Button type="button" variant="outline" size="sm" onClick={onReturnToFullView}>
        <ArrowLeft aria-hidden="true" className="size-4" />
        Full Company View
      </Button>
      <p className="text-foreground font-medium">
        {view === "position" ? "Position Focus" : "Department Focus"}
        {focusLabel ? (
          <span className="text-muted-foreground font-normal"> · {focusLabel}</span>
        ) : null}
      </p>

      {view === "position" ? (
        <label className="ml-auto flex items-center gap-2">
          <span className="text-muted-foreground text-xs">Descendant depth</span>
          <Select
            aria-label="Descendant depth"
            value={String(depth)}
            onChange={(event) => {
              const value = event.target.value;
              onDepthChange(value === "all" ? "all" : (Number(value) as 1 | 2 | 3));
            }}
            className="h-8 w-auto min-w-40"
          >
            {DEPTH_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
      ) : null}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleCopy}
        className={view === "position" ? "" : "ml-auto"}
      >
        {copyState === "copied" ? (
          <Check aria-hidden="true" className="size-4" />
        ) : (
          <LinkIcon aria-hidden="true" className="size-4" />
        )}
        {copyState === "copied"
          ? "Copied!"
          : copyState === "failed"
            ? "Copy failed"
            : "Copy View Link"}
      </Button>
    </div>
  );
}
