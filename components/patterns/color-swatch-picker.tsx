"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

/** Reuses the department chart-grouping palette already defined in app/globals.css (--color-dept-1..8) so a picked color always matches what the eventual organogram (Phase 8) will render. */
export const DEPARTMENT_COLOR_PRESETS = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#65a30d",
] as const;

interface ColorSwatchPickerProps {
  id: string;
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

export function ColorSwatchPicker({
  id,
  value,
  onChange,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: ColorSwatchPickerProps) {
  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label="Color presets" className="flex flex-wrap gap-2">
        {DEPARTMENT_COLOR_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onChange(preset)}
            aria-pressed={value === preset}
            aria-label={`Use color ${preset}`}
            className={cn(
              "flex size-8 items-center justify-center rounded-full border-2 transition-transform",
              value === preset ? "border-foreground scale-110" : "border-transparent"
            )}
            style={{ backgroundColor: preset }}
          >
            {value === preset ? <Check aria-hidden="true" className="size-4 text-white" /> : null}
          </button>
        ))}
      </div>
      <Input
        id={id}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
        placeholder="#16a34a (optional)"
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        className="max-w-40"
      />
    </div>
  );
}
