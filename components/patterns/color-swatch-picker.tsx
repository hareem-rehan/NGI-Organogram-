"use client";

import { Check, Pipette } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

const FULL_HEX = /^#[0-9a-fA-F]{6}$/;

/** Department chart-grouping palette, aligned to the stakeholder's Visily reference (green Engineering, blue Client Delivery/Project, purple Product, gold HR, orange Marketing, pink Delivery/Admin, lavender Finance, teal IT). The organogram cards colour by each department's own chosen hue. */
export const DEPARTMENT_COLOR_PRESETS = [
  "#4fae2f",
  "#3aa4e8",
  "#7c3aed",
  "#d9a400",
  "#e8811a",
  "#ec6fa8",
  "#9b7fe0",
  "#00b8d4",
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
  const normalized = (value ?? "").toLowerCase();
  const isPreset = (DEPARTMENT_COLOR_PRESETS as readonly string[]).includes(normalized);
  // A valid full hex that is NOT one of the presets is a "custom" pick —
  // shown filled on the picker swatch so the choice is visible at a glance.
  const isCustom = FULL_HEX.test(normalized) && !isPreset;
  // Native <input type="color"> needs a concrete 6-digit hex; fall back to
  // black when the field is empty or a partial value is being typed.
  const pickerValue = FULL_HEX.test(normalized) ? normalized : "#000000";

  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label="Color presets" className="flex flex-wrap items-center gap-2">
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

        {/* Full-spectrum picker. A label wraps the native colour input so
            the whole swatch is the trigger; the input itself is visually
            hidden but keyboard- and screen-reader-reachable. */}
        <label
          title="Pick a custom color"
          className={cn(
            "relative flex size-8 cursor-pointer items-center justify-center rounded-full border-2 transition-transform",
            isCustom ? "border-foreground scale-110" : "border-border border-dashed"
          )}
          style={isCustom ? { backgroundColor: normalized } : undefined}
        >
          <input
            type="color"
            value={pickerValue}
            onChange={(event) => onChange(event.target.value)}
            aria-label="Pick a custom color"
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
          {isCustom ? (
            <Check aria-hidden="true" className="size-4 text-white" />
          ) : (
            <Pipette aria-hidden="true" className="text-muted-foreground size-4" />
          )}
        </label>
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
