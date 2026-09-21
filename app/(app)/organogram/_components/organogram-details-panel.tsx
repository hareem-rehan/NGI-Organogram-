"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { OrganogramNode } from "@/lib/domain/organogram";

interface OrganogramDetailsPanelProps {
  node: OrganogramNode;
  /** Whether the caller holds employees:view — gates the link to the occupant's own (independently authorization-gated) detail page. */
  canViewEmployeeDetails: boolean;
  onClose: () => void;
  /** Phase 9: entry points into Position/Department Focus (docs/ORGANOGRAM_SEARCH_AND_FOCUS.md — "Focus View is available from... the position details panel"). */
  onFocusPosition: (positionId: string) => void;
  onFocusDepartment: (departmentId: string) => void;
}

/**
 * Read-only. Every link here re-lands on a route that independently
 * re-checks authorization server-side (docs/AUTHORIZATION_MATRIX.md) —
 * this panel's own visibility is never treated as sufficient elsewhere.
 */
export function OrganogramDetailsPanel({
  node,
  canViewEmployeeDetails,
  onClose,
  onFocusPosition,
  onFocusDepartment,
}: OrganogramDetailsPanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [node.positionId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const statusVariant =
    node.positionStatus === "ACTIVE"
      ? "success"
      : node.positionStatus === "PLANNED"
        ? "outline"
        : "muted";

  return (
    <aside
      aria-label="Position details"
      className="border-border bg-background flex w-full flex-col gap-3 border-t p-4 sm:h-full sm:w-80 sm:shrink-0 sm:border-t-0 sm:border-l"
    >
      <div className="flex items-start justify-between gap-2">
        <h3
          ref={headingRef}
          tabIndex={-1}
          className="text-foreground text-base font-semibold outline-none"
        >
          {node.title}
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close position details"
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Status</dt>
        <dd>
          <Badge variant={statusVariant}>{node.positionStatus}</Badge>
        </dd>
        <dt className="text-muted-foreground">Occupant</dt>
        <dd>
          {node.occupancyStatus === "occupied" ? (
            canViewEmployeeDetails && node.occupantEmployeeId ? (
              <Link href={`/employees/${node.occupantEmployeeId}`} className="underline">
                {node.occupantDisplayName}
              </Link>
            ) : (
              node.occupantDisplayName
            )
          ) : (
            <span className="text-status-vacant font-medium">Vacant</span>
          )}
        </dd>
        <dt className="text-muted-foreground">Department</dt>
        <dd>
          {node.departmentName} ({node.departmentCode})
        </dd>
        <dt className="text-muted-foreground">Organizational level</dt>
        <dd>{node.organizationalLevel}</dd>
        <dt className="text-muted-foreground">Job grade</dt>
        <dd>{node.jobGradeName ?? "—"}</dd>
        <dt className="text-muted-foreground">Position code</dt>
        <dd>{node.positionCode}</dd>
        <dt className="text-muted-foreground">Direct reports</dt>
        <dd>{node.directReportCount}</dd>
      </dl>
      <div className="mt-1 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onFocusPosition(node.positionId)}
        >
          Focus on this position
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onFocusDepartment(node.departmentId)}
        >
          Focus on this department
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={`/positions?search=${encodeURIComponent(node.positionCode)}`}>
            View position record
          </Link>
        </Button>
      </div>
    </aside>
  );
}
