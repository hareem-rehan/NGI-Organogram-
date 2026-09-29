"use client";

import { useMemo, useState, useTransition } from "react";
import type { CareerTrackKind, Department, JobFamily } from "@prisma/client";
import { Plus, X } from "lucide-react";

import { Select } from "@/components/ui/select";
import { resolveDepartmentColor } from "@/lib/domain/export/colors";
import { lightTint } from "@/lib/domain/organogram-family-colors";
import { JOB_GRADE_SCALE } from "@/lib/domain/job-grade-mapping";
import {
  buildLevelsMappingColumns,
  type LevelsMappingColumnGroup,
} from "@/lib/domain/levels-mapping-columns";
import {
  deleteDepartmentLevelTitleAction,
  deleteJobFamilyLevelTitleAction,
  getLevelsMappingAction,
  setLevelsMappingColumnAction,
  type LevelsMappingTitles,
} from "@/app/(app)/levels-mapping/actions";
import { LevelTitleDialog, type LevelTitleTarget } from "./level-title-dialog";

interface LevelsMappingViewProps {
  canManage: boolean;
  departments: Department[];
  subDivisions?: JobFamily[];
  initialTitles: LevelsMappingTitles;
}

const LADDER_LABEL: Record<CareerTrackKind, string> = { IC: "IC", MANAGER: "Manager" };

interface CellTitle {
  id: string;
  title: string;
}

function cellKey(groupId: string, kind: CareerTrackKind, jobGradeCode: string): string {
  return `${groupId}|${kind}|${jobGradeCode}`;
}

/** `<select>` option values for the "Add column" picker. */
const optionValue = (type: LevelsMappingColumnGroup["type"], id: string) => `${type}:${id}`;

export function LevelsMappingView({
  canManage,
  departments: initialDepartments,
  subDivisions: initialSubDivisions = [],
  initialTitles,
}: LevelsMappingViewProps) {
  const [departments, setDepartments] = useState(initialDepartments);
  const [subDivisions, setSubDivisions] = useState(initialSubDivisions);
  const [titles, setTitles] = useState(initialTitles);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dialogTarget, setDialogTarget] = useState<LevelTitleTarget | null>(null);
  const [pending, startTransition] = useTransition();

  // A department's colour: its own colour (or the neutral fallback) as the
  // header accent, and a light tint for the cell bodies — the same palette
  // helpers the organogram uses, so the two read alike. A sub-division
  // borrows its department's colour.
  const colorByDept = useMemo(() => {
    const map = new Map<string, { accent: string; tint: string }>();
    for (const d of departments) {
      const accent = resolveDepartmentColor(d.color);
      map.set(d.id, { accent, tint: lightTint(accent) });
    }
    return map;
  }, [departments]);

  // The column groups HR chose to show (docs/DECISIONS.md D34).
  const groups = useMemo(
    () => buildLevelsMappingColumns(departments, subDivisions),
    [departments, subDivisions]
  );

  const titlesByCell = useMemo(() => {
    const map = new Map<string, CellTitle[]>();
    const add = (groupId: string, kind: CareerTrackKind, code: string, t: CellTitle) => {
      const key = cellKey(groupId, kind, code);
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    };
    for (const t of titles.departmentTitles) add(t.departmentId, t.kind, t.jobGradeCode, t);
    for (const t of titles.subDivisionTitles) add(t.jobFamilyId, t.kind, t.jobGradeCode, t);
    for (const list of map.values()) list.sort((a, b) => a.title.localeCompare(b.title));
    return map;
  }, [titles]);

  // Hidden departments / sub-divisions, grouped by department, for the
  // "Add column" picker.
  const hiddenOptions = useMemo(
    () =>
      departments
        .map((d) => ({
          department: d,
          departmentHidden: !d.showInLevelsMapping,
          families: subDivisions.filter((f) => f.departmentId === d.id && !f.showInLevelsMapping),
        }))
        .filter((o) => o.departmentHidden || o.families.length > 0),
    [departments, subDivisions]
  );

  function refetch() {
    startTransition(async () => {
      const result = await getLevelsMappingAction();
      if (result.ok) setTitles(result.data);
    });
  }

  function runDelete(group: LevelsMappingColumnGroup, id: string) {
    setActionError(null);
    startTransition(async () => {
      const result =
        group.type === "SUB_DIVISION"
          ? await deleteJobFamilyLevelTitleAction({ id })
          : await deleteDepartmentLevelTitleAction({ id });
      if (!result.ok) {
        setActionError(result.error ?? "Something went wrong.");
        return;
      }
      refetch();
    });
  }

  function setVisible(type: LevelsMappingColumnGroup["type"], id: string, visible: boolean) {
    setActionError(null);
    startTransition(async () => {
      const result = await setLevelsMappingColumnAction({ target: type, id, visible });
      if (!result.ok) {
        setActionError(result.error ?? "Something went wrong.");
        return;
      }
      if (type === "DEPARTMENT") {
        setDepartments((all) =>
          all.map((d) => (d.id === id ? { ...d, showInLevelsMapping: visible } : d))
        );
      } else {
        setSubDivisions((all) =>
          all.map((f) => (f.id === id ? { ...f, showInLevelsMapping: visible } : f))
        );
      }
    });
  }

  if (departments.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
        No departments yet. Create a department first, then map its level names here.
      </p>
    );
  }

  const addColumnPicker =
    canManage && hiddenOptions.length > 0 ? (
      <div className="w-64">
        <Select
          aria-label="Add column"
          value=""
          disabled={pending}
          onChange={(event) => {
            const [type, id] = event.target.value.split(":");
            if (id && (type === "DEPARTMENT" || type === "SUB_DIVISION")) {
              setVisible(type, id, true);
            }
          }}
        >
          <option value="" disabled>
            + Add column…
          </option>
          {hiddenOptions.map(({ department, departmentHidden, families }) => (
            <optgroup key={department.id} label={department.name}>
              {departmentHidden ? (
                <option value={optionValue("DEPARTMENT", department.id)}>
                  {department.name} (department)
                </option>
              ) : null}
              {families.map((f) => (
                <option key={f.id} value={optionValue("SUB_DIVISION", f.id)}>
                  {f.name} (sub-division)
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </div>
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground max-w-2xl text-sm">
          Level names by department or sub-division, ladder (IC / Manager) and level. These are the
          titles offered when adding a position — they describe career progression only and never
          set who reports to whom.
        </p>
        {addColumnPicker}
      </div>

      {actionError ? (
        <p role="alert" className="text-destructive text-sm font-medium">
          {actionError}
        </p>
      ) : null}

      {groups.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          {canManage
            ? "No columns are shown yet. Use “Add column” to pick a department or sub-division."
            : "No columns are shown yet."}
        </p>
      ) : (
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
                {groups.map((g) => {
                  const color = colorByDept.get(g.departmentId);
                  const isSub = g.type === "SUB_DIVISION";
                  return (
                    <th
                      key={g.id}
                      colSpan={g.ladders.length}
                      scope="colgroup"
                      className="border-b border-l p-2 text-center text-sm font-semibold"
                      style={
                        isSub
                          ? {
                              backgroundColor: color?.tint,
                              borderTop: `3px solid ${color?.accent}`,
                            }
                          : { backgroundColor: color?.accent, color: "#ffffff" }
                      }
                    >
                      <span className="flex items-center justify-center gap-1.5">
                        <span className="flex flex-col leading-tight">
                          {g.name}
                          {isSub ? (
                            <span className="text-muted-foreground text-[11px] font-normal">
                              Sub-division · {g.departmentName}
                            </span>
                          ) : null}
                        </span>
                        {canManage ? (
                          <button
                            type="button"
                            disabled={pending}
                            className="shrink-0 rounded opacity-80 hover:opacity-100"
                            aria-label={`Remove ${g.name} columns`}
                            title="Remove these columns (level names are kept)"
                            onClick={() => setVisible(g.type, g.id, false)}
                          >
                            <X aria-hidden="true" className="size-3.5" />
                          </button>
                        ) : null}
                      </span>
                    </th>
                  );
                })}
              </tr>
              <tr>
                {groups.flatMap((g) =>
                  g.ladders.map((kind, i) => (
                    <th
                      key={`${g.id}-${kind}`}
                      scope="col"
                      className={`text-muted-foreground border-b p-1.5 text-center text-xs font-medium ${i === 0 ? "border-l" : ""}`}
                    >
                      {LADDER_LABEL[kind]}
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
                  {groups.flatMap((g) => {
                    const color = colorByDept.get(g.departmentId);
                    return g.ladders.map((kind, i) => {
                      const cell = titlesByCell.get(cellKey(g.id, kind, scale.code)) ?? [];
                      const target = {
                        ownerType: g.type,
                        ownerId: g.id,
                        ownerName: g.name,
                        kind,
                        jobGradeCode: scale.code,
                        scaleName: scale.name,
                      };
                      return (
                        <td
                          key={`${g.id}-${kind}-${scale.code}`}
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
                                        ...target,
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
                                    onClick={() => runDelete(g, entry.id)}
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
                                aria-label={`Add ${LADDER_LABEL[kind]} ${scale.code} level name in ${g.name}`}
                                onClick={() => setDialogTarget({ mode: "create", ...target })}
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
      )}

      {canManage ? (
        <LevelTitleDialog
          // Remount per target so the dialog's state initialises fresh on each
          // open, without syncing props into state via an effect.
          key={
            dialogTarget
              ? `${dialogTarget.mode}:${dialogTarget.id ?? ""}:${dialogTarget.ownerId}:${dialogTarget.kind}:${dialogTarget.jobGradeCode}`
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
