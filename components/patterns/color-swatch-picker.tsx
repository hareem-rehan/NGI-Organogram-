"use client";

import { Check, Pipette } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

const FULL_HEX = /^#[0-9a-fA-F]{6}$/;

/** Department chart-grouping palette, aligned to the stakeholder's Visily reference (green Engineering, blue Client Delivery/Project, purple Product, gold HR, orange Marketing, pink Delivery/Admin, lavender Finance, teal IT). The organogram cards colour by each department's own chosen hue. */
/**
 * Quick picks. The first seven are the Visily reference hues, so a department
 * given one of them renders with the reference chart's exact card colours
 * (lib/domain/organogram-family-colors.ts VISILY_DEPARTMENT_SWATCHES); the
 * rest are extra vivid options. Any other colour can be chosen with the
 * "Custom colour" picker.
 */
export const DEPARTMENT_COLOR_PRESETS = [
  "#4fae2f",
  "#3aa4e8",
  "#d9a400",
  "#e8811a",
  "#ec6fa8",
  "#9b7fe0",
  "#6d28d9",
  "#00b8d4",
  "#e11d48",
  "#0d9488",
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
      </div>

      {/* Full-spectrum picker, as a clearly labelled control (not just an
          icon): a label wraps the native colour input so the whole pill is
          the trigger; the input itself is visually hidden but keyboard- and
          screen-reader-reachable. The pill's swatch previews the current
          colour. */}
      <div className="flex flex-wrap items-center gap-2">
        <label
          className={cn(
            "hover:bg-accent focus-within:ring-ring relative inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium focus-within:ring-2",
            isCustom ? "border-foreground" : "border-border"
          )}
        >
          <input
            type="color"
            value={pickerValue}
            onChange={(event) => onChange(event.target.value)}
            aria-label="Pick a custom color"
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
          <span
            aria-hidden="true"
            className="border-border inline-block size-5 rounded-full border"
            style={{
              background: FULL_HEX.test(normalized)
                ? normalized
                : "conic-gradient(#ef4444, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ef4444)",
            }}
          />
          <Pipette aria-hidden="true" className="text-muted-foreground size-4" />
          Custom colour…
        </label>
        <Input
          id={id}
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value || null)}
          placeholder="#16a34a (optional)"
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          className="max-w-32"
        />
      </div>
    </div>
  );
}
