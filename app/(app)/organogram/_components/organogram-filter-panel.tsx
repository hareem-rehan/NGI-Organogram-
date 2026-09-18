"use client";

import { useId, useMemo } from "react";

import { Button } from "@/components/ui/button";
import {
  isAnyFilterActive,
  type OccupancyFilter,
  type OrganogramFilterState,
} from "@/lib/domain/organogram-filters";
import type { OrganogramNode, PositionStatus } from "@/lib/domain/organogram";

interface OrganogramFilterPanelProps {
  nodes: readonly OrganogramNode[];
  filters: OrganogramFilterState;
  onFiltersChange: (filters: OrganogramFilterState) => void;
  matchCount: number;
}

const STATUS_LABEL: Record<PositionStatus, string> = {
  PLANNED: "Planned",
  ACTIVE: "Active",
  INACTIVE: "Inactive",
};
const STATUS_VALUES: readonly PositionStatus[] = ["PLANNED", "ACTIVE", "INACTIVE"];

function toggleInSet<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/**
 * Filter OPTIONS are derived from the data actually present (distinct
 * departments/levels/job grades among `nodes`) rather than a fixed
 * universe — never offers a phantom category with zero possible matches.
 */
export function OrganogramFilterPanel({
  nodes,
  filters,
  onFiltersChange,
  matchCount,
}: OrganogramFilterPanelProps) {
  const groupId = useId();

  const departmentOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const n of nodes) seen.set(n.departmentId, n.departmentName);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [nodes]);

  const levelOptions = useMemo(
    () => [...new Set(nodes.map((n) => n.organizationalLevel))].sort((a, b) => a - b),
    [nodes]
  );

  const gradeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    let hasUnassigned = false;
    for (const n of nodes) {
      if (n.jobGradeId) seen.set(n.jobGradeId, n.jobGradeName ?? n.jobGradeId);
      else hasUnassigned = true;
    }
    const entries: { id: string | null; label: string }[] = [...seen.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, label]) => ({ id, label }));
    if (hasUnassigned) entries.push({ id: null, label: "Not Assigned" });
    return entries;
  }, [nodes]);

  const active = isAnyFilterActive(filters);

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex items-center justify-between">
        <p aria-live="polite" className="text-muted-foreground text-xs">
          {active
            ? `${matchCount} matching position${matchCount === 1 ? "" : "s"}`
            : "All positions"}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!active}
          onClick={() =>
            onFiltersChange({
              departmentIds: new Set(),
              levels: new Set(),
              jobGradeIds: new Set(),
              occupancy: "all",
              statuses: new Set(),
            })
          }
        >
          Clear All Filters
        </Button>
      </div>

      {departmentOptions.length > 0 ? (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-foreground mb-1 text-xs font-semibold">Department</legend>
          {departmentOptions.map(([id, name]) => (
            <label key={id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={filters.departmentIds.has(id)}
                onChange={() =>
                  onFiltersChange({
                    ...filters,
                    departmentIds: toggleInSet(filters.departmentIds, id),
                  })
                }
                className="accent-primary size-4"
              />
              {name}
            </label>
          ))}
        </fieldset>
      ) : null}

      {levelOptions.length > 0 ? (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-foreground mb-1 text-xs font-semibold">
            Organizational Level
          </legend>
          {levelOptions.map((level) => (
            <label key={level} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={filters.levels.has(level)}
                onChange={() =>
                  onFiltersChange({ ...filters, levels: toggleInSet(filters.levels, level) })
                }
                className="accent-primary size-4"
              />
              Level {level}
            </label>
          ))}
        </fieldset>
      ) : null}

      {gradeOptions.length > 0 ? (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-foreground mb-1 text-xs font-semibold">Job Grade</legend>
          {gradeOptions.map((grade) => (
            <label key={grade.id ?? "not-assigned"} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={filters.jobGradeIds.has(grade.id)}
                onChange={() =>
                  onFiltersChange({
                    ...filters,
                    jobGradeIds: toggleInSet(filters.jobGradeIds, grade.id),
                  })
                }
                className="accent-primary size-4"
              />
              {grade.label}
            </label>
          ))}
        </fieldset>
      ) : null}

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-foreground mb-1 text-xs font-semibold">Occupancy</legend>
        {(["all", "occupied", "vacant"] as const satisfies readonly OccupancyFilter[]).map(
          (value) => (
            <label key={value} className="flex items-center gap-2">
              <input
                type="radio"
                name={`${groupId}-occupancy`}
                checked={filters.occupancy === value}
                onChange={() => onFiltersChange({ ...filters, occupancy: value })}
                className="accent-primary size-4"
              />
              {value === "all" ? "All" : value === "occupied" ? "Occupied" : "Vacant"}
            </label>
          )
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-foreground mb-1 text-xs font-semibold">Position Status</legend>
        {STATUS_VALUES.map((status) => (
          <label key={status} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={filters.statuses.has(status)}
              onChange={() =>
                onFiltersChange({ ...filters, statuses: toggleInSet(filters.statuses, status) })
              }
              className="accent-primary size-4"
            />
            {STATUS_LABEL[status]}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
