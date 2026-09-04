"use client";

import { useState } from "react";
import { Info, X } from "lucide-react";

import { Button } from "@/components/ui/button";

interface DepartmentLegendEntry {
  id: string;
  name: string;
  color: string | null;
}

/**
 * Collapsed by default (a small toggle button) rather than an
 * always-open overlay — an always-open legend was found (via
 * e2e/organogram.spec.ts) to visually cover graph nodes for small
 * hierarchies once Fit to View zooms in, blocking clicks underneath it.
 * Every entry pairs a color swatch with a text label — color is never
 * the only signal (docs/ORGANOGRAM_RENDERING.md "Node-Content
 * Specification").
 */
export function OrganogramLegend({
  departments,
}: {
  departments: readonly DepartmentLegendEntry[];
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        className="bg-background/95 shadow-sm backdrop-blur-sm"
      >
        <Info aria-hidden="true" className="size-4" />
        Legend
      </Button>
    );
  }

  return (
    <div className="border-border bg-background/95 w-56 rounded-lg border p-3 text-xs shadow-sm backdrop-blur-sm">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-foreground font-semibold">Legend</p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-expanded={true}
          aria-label="Close legend"
          onClick={() => setOpen(false)}
          className="size-6"
        >
          <X aria-hidden="true" className="size-3.5" />
        </Button>
      </div>
      <ul className="flex flex-col gap-1.5">
        <li className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="bg-status-filled inline-block size-2.5 rounded-full"
          />
          Occupied
        </li>
        <li className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="bg-status-vacant inline-block size-2.5 rounded-full"
          />
          Vacant
        </li>
        <li className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="border-status-planned inline-block size-2.5 rounded-full border-2"
          />
          Planned position
        </li>
        <li className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="bg-status-inactive inline-block size-2.5 rounded-full opacity-75"
          />
          Inactive position
        </li>
        <li className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="border-primary inline-block size-2.5 rounded-full border-2"
          />
          Selected
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="bg-border inline-block h-0.5 w-3" />
          Primary reporting line
        </li>
        <li className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="border-primary/60 inline-block size-2.5 rounded-full border-2"
          />
          Match — satisfies the active search or filter
        </li>
        <li className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="bg-muted-foreground inline-block size-2.5 rounded-full opacity-60"
          />
          Context — shown to preserve the real reporting path, not itself a match
        </li>
      </ul>
      {departments.length > 0 ? (
        <>
          <p className="text-foreground mt-3 mb-1 font-semibold">Departments</p>
          <ul className="flex max-h-32 flex-col gap-1.5 overflow-y-auto">
            {departments.map((department) => (
              <li key={department.id} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="border-border inline-block size-2.5 shrink-0 rounded-full border"
                  style={{ backgroundColor: department.color ?? "transparent" }}
                />
                <span className="truncate">{department.name}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
