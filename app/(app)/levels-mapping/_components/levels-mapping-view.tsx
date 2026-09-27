"use client";

import { useMemo, useState, useTransition } from "react";
import type { CareerTrackKind, Department, DepartmentLevelTitle } from "@prisma/client";
import { Plus, X } from "lucide-react";

import { resolveDepartmentColor } from "@/lib/domain/export/colors";
import { lightTint } from "@/lib/domain/organogram-family-colors";
import { JOB_GRADE_SCALE } from "@/lib/domain/job-grade-mapping";
import {
  deleteDepartmentLevelTitleAction,
  getLevelsMappingAction,
} from "@/app/(app)/levels-mapping/actions";
import { LevelTitleDialog, type LevelTitleTarget } from "./level-title-dialog";

interface LevelsMappingViewProps {
  canManage: boolean;
  departments: Department[];
  initialTitles: DepartmentLevelTitle[];
}

const LADDERS: readonly { kind: CareerTrackKind; label: string }[] = [
  { kind: "IC", label: "IC" },
  { kind: "MANAGER", label: "Manager" },
];

function cellKey(departmentId: string, kind: CareerTrackKind, jobGradeCode: string): string {
  return `${departmentId}|${kind}|${jobGradeCode}`;
}

export function LevelsMappingView({
  canManage,
  departments,
  initialTitles,
}: LevelsMappingViewProps) {
  const [titles, setTitles] = useState(initialTitles);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dialogTarget, setDialogTarget] = useState<LevelTitleTarget | null>(null);
  const [, startTransition] = useTransition();

  // A department's colour: its own colour (or the neutral fallback) as the
  // header accent, and a light tint for the cell bodies — the same palette
  // helpers the organogram uses, so the two read alike.
  const colorByDept = useMemo(() => {
    const map = new Map<string, { accent: string; tint: string }>();
    for (const d of departments) {
      const accent = resolveDepartmentColor(d.color);
      map.set(d.id, { accent, tint: lightTint(accent) });
    }
    return map;
  }, [departments]);

  // The ladders (columns) a department runs, and the departments that run at
  // least one — a department with neither IC nor Manager (e.g. Founder) is
  // left out of the grid entirely.
  const laddersFor = (d: Department) =>
    LADDERS.filter((l) => (l.kind === "IC" ? d.hasIcLadder : d.hasManagerLadder));
  const visibleDepartments = departments.filter((d) => d.hasIcLadder || d.hasManagerLadder);

  const titlesByCell = useMemo(() => {
    const map = new Map<string, DepartmentLevelTitle[]>();
    for (const t of titles) {
      const key = cellKey(t.departmentId, t.kind, t.jobGradeCode);
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.title.localeCompare(b.title));
    return map;
  }, [titles]);

  function refetch() {
    startTransition(async () => {
      const result = await getLevelsMappingAction();
      if (result.ok) setTitles(result.data);
    });
  }

  function runDelete(id: string) {
    setActionError(null);
    startTransition(async () => {
      const result = await deleteDepartmentLevelTitleAction({ id });
      if (!result.ok) {
        setActionError(result.error ?? "Something went wrong.");
        return;
      }
      refetch();
    });
  }

  if (departments.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
        No departments yet. Create a department first, then map its level names here.
      </p>
    );
  }

  if (visibleDepartments.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
        No departments have career ladders yet. Set a department&apos;s career ladders to Individual
        Contributor and/or Manager to map level names here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground max-w-2xl text-sm">
          Level names by department, ladder (IC / Manager) and level. These are the titles offered
          when adding a position — they describe career progression only and never set who reports
          to whom.
        </p>
        {/* Legend of department colours. */}
        <div className="flex flex-wrap items-center gap-3">
          {visibleDepartments.map((d) => (
            <span key={d.id} className="flex items-center gap-1.5 text-xs">
              <span
                aria-hidden="true"
                className="inline-block size-3 rounded-full"
                style={{ backgroundColor: colorByDept.get(d.id)?.accent }}
              />
              {d.name}
            </span>
          ))}
        </div>
      </div>

      {actionError ? (
        <p role="alert" className="text-destructive text-sm font-medium">
          {actionError}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th
                rowSpan={2}
                scope="col"
                className="bg-muted text-muted-foreground sticky left-0 z-10 border-r border-b p-2 text-left align-bottom text-xs font-medium"
              >
                Level
              </th>
              {visibleDepartments.map((d) => (
                <th
                  key={d.id}
                  colSpan={laddersFor(d).length}
                  scope="colgroup"
                  className="border-b border-l p-2 text-center text-sm font-semibold"
                  style={{ backgroundColor: colorByDept.get(d.id)?.accent, color: "#ffffff" }}
                >
                  {d.name}
                </th>
              ))}
            </tr>
            <tr>
              {visibleDepartments.flatMap((d) =>
                laddersFor(d).map((ladder, i) => (
                  <th
                    key={`${d.id}-${ladder.kind}`}
                    scope="col"
                    className={`text-muted-foreground border-b p-1.5 text-center text-xs font-medium ${i === 0 ? "border-l" : ""}`}
                  >
                    {ladder.label}
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {JOB_GRADE_SCALE.map((scale) => (
              <tr key={scale.code} className="align-top">
                <th
                  scope="row"
                  className="bg-muted sticky left-0 z-10 border-r border-b p-2 text-left align-top whitespace-nowrap"
                >
                  <span className="font-semibold">{scale.code}</span>
                  <span className="text-muted-foreground block text-xs">{scale.name}</span>
                </th>
                {visibleDepartments.flatMap((d) => {
                  const color = colorByDept.get(d.id);
                  return laddersFor(d).map((ladder, i) => {
                    const cell = titlesByCell.get(cellKey(d.id, ladder.kind, scale.code)) ?? [];
                    return (
                      <td
                        key={`${d.id}-${ladder.kind}-${scale.code}`}
                        className={`border-b p-1.5 ${i === 0 ? "border-l" : ""}`}
                      >
                        <div className="flex flex-col gap-1">
                          {cell.map((entry) => (
                            <span
                              key={entry.id}
                              className="group flex items-center gap-1 rounded-md px-2 py-1 text-xs"
                              style={{ backgroundColor: color?.tint }}
                            >
                              <span
                                aria-hidden="true"
                                className="inline-block size-2 shrink-0 rounded-full"
                                style={{ backgroundColor: color?.accent }}
                              />
                              {canManage ? (
                                <button
                                  type="button"
                                  className="min-w-0 flex-1 text-left hover:underline"
                                  aria-label={`Edit ${entry.title}`}
                                  onClick={() =>
                                    setDialogTarget({
                                      mode: "edit",
                                      departmentId: d.id,
                                      departmentName: d.name,
                                      kind: ladder.kind,
                                      jobGradeCode: scale.code,
                                      scaleName: scale.name,
                                      id: entry.id,
                                      title: entry.title,
                                    })
                                  }
                                >
                                  {entry.title}
                                </button>
                              ) : (
                                <span className="min-w-0 flex-1">{entry.title}</span>
                              )}
                              {canManage ? (
                                <button
                                  type="button"
                                  className="text-muted-foreground hover:text-destructive shrink-0"
                                  aria-label={`Remove ${entry.title}`}
                                  onClick={() => runDelete(entry.id)}
                                >
                                  <X aria-hidden="true" className="size-3" />
                                </button>
                              ) : null}
                            </span>
                          ))}
                          {canManage ? (
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-foreground flex items-center gap-1 rounded-md px-1 py-0.5 text-xs"
                              aria-label={`Add ${ladder.label} ${scale.code} level name in ${d.name}`}
                              onClick={() =>
                                setDialogTarget({
                                  mode: "create",
                                  departmentId: d.id,
                                  departmentName: d.name,
                                  kind: ladder.kind,
                                  jobGradeCode: scale.code,
                                  scaleName: scale.name,
                                })
                              }
                            >
                              <Plus aria-hidden="true" className="size-3" />
                              {cell.length === 0 ? "Add" : null}
                            </button>
                          ) : cell.length === 0 ? (
                            <span className="text-muted-foreground/50 text-xs">—</span>
                          ) : null}
                        </div>
                      </td>
                    );
                  });
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canManage ? (
        <LevelTitleDialog
          // Remount per target so the dialog's state initialises fresh on each
          // open, without syncing props into state via an effect.
          key={
            dialogTarget
              ? `${dialogTarget.mode}:${dialogTarget.id ?? ""}:${dialogTarget.departmentId}:${dialogTarget.kind}:${dialogTarget.jobGradeCode}`
              : "closed"
          }
          target={dialogTarget}
          onOpenChange={(open) => {
            if (!open) setDialogTarget(null);
          }}
          onSaved={refetch}
        />
      ) : null}
    </div>
  );
}
