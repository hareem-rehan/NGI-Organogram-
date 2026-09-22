"use client";

import { useMemo, useState, useTransition } from "react";
import type {
  CareerTrack,
  Department,
  JobFamily,
  JobGrade,
  LevelMappingEntry,
} from "@prisma/client";
import { Plus, Trash2, Pencil } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  addManagerLadderAction,
  deleteCareerTrackAction,
  deleteJobFamilyAction,
  deleteLevelMappingEntryAction,
  getCareerFrameworkAction,
  provisionStandardLevelsAction,
} from "@/app/(app)/career-framework/actions";
import { JobFamilyDialog } from "./job-family-dialog";
import { LevelMappingDialog } from "./level-mapping-dialog";

interface CareerFrameworkViewProps {
  canManage: boolean;
  initialJobFamilies: JobFamily[];
  initialCareerTracks: CareerTrack[];
  initialLevelMappingEntries: LevelMappingEntry[];
  departments: Department[];
  jobGrades: JobGrade[];
}

const TRACK_ORDER: Record<string, number> = { IC: 0, MANAGER: 1 };

export function CareerFrameworkView({
  canManage,
  initialJobFamilies,
  initialCareerTracks,
  initialLevelMappingEntries,
  departments,
  jobGrades,
}: CareerFrameworkViewProps) {
  const [jobFamilies, setJobFamilies] = useState(initialJobFamilies);
  const [careerTracks, setCareerTracks] = useState(initialCareerTracks);
  const [entries, setEntries] = useState(initialLevelMappingEntries);
  const [levels, setLevels] = useState(jobGrades);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [familyDialogOpen, setFamilyDialogOpen] = useState(false);
  const [editingFamily, setEditingFamily] = useState<JobFamily | null>(null);
  const [mappingForFamily, setMappingForFamily] = useState<JobFamily | null>(null);

  const departmentsById = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments]);
  const gradesById = useMemo(() => new Map(levels.map((g) => [g.id, g])), [levels]);

  function refetch() {
    startTransition(async () => {
      const result = await getCareerFrameworkAction();
      if (result.ok) {
        setJobFamilies(result.data.jobFamilies);
        setCareerTracks(result.data.careerTracks);
        setEntries(result.data.levelMappingEntries);
        setLevels(result.data.jobGrades);
      }
    });
  }

  function runManage(action: () => Promise<{ ok: boolean; error?: string }>) {
    setActionError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setActionError(result.error ?? "Something went wrong.");
        return;
      }
      refetch();
    });
  }

  const tracksByFamily = useMemo(() => {
    const map = new Map<string, CareerTrack[]>();
    for (const track of careerTracks) {
      const list = map.get(track.jobFamilyId) ?? [];
      list.push(track);
      map.set(track.jobFamilyId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (TRACK_ORDER[a.kind] ?? 9) - (TRACK_ORDER[b.kind] ?? 9));
    }
    return map;
  }, [careerTracks]);

  const entriesByFamily = useMemo(() => {
    const map = new Map<string, LevelMappingEntry[]>();
    for (const entry of entries) {
      const list = map.get(entry.jobFamilyId) ?? [];
      list.push(entry);
      map.set(entry.jobFamilyId, list);
    }
    return map;
  }, [entries]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-muted-foreground max-w-2xl text-sm">
          Career progression only. Levels, job families and IC/Manager tracks describe career
          seniority — they never set who reports to whom. The organogram is built from reporting
          relationships alone.
        </p>
        {canManage ? (
          <Button
            onClick={() => {
              setEditingFamily(null);
              setFamilyDialogOpen(true);
            }}
          >
            <Plus aria-hidden="true" className="size-4" /> Add Job Family
          </Button>
        ) : null}
      </div>

      {actionError ? (
        <p role="alert" className="text-destructive text-sm font-medium">
          {actionError}
        </p>
      ) : null}

      {levels.length === 0 ? (
        <div className="border-border bg-muted/30 flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-foreground text-sm font-medium">No levels set up yet</p>
            <p className="text-muted-foreground mt-0.5 text-sm">
              Levels (L2–L18) are the rows of the career matrix and the seniority you pick for a
              position. Add the standard scale to get started — you can rename or remove levels
              afterwards.
            </p>
          </div>
          {canManage ? (
            <Button
              className="shrink-0"
              disabled={pending}
              onClick={() => runManage(() => provisionStandardLevelsAction())}
            >
              <Plus aria-hidden="true" className="size-4" /> Set up standard levels
            </Button>
          ) : null}
        </div>
      ) : null}

      {jobFamilies.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          No job families yet. {canManage ? "Add one to start building the career matrix." : ""}
        </p>
      ) : (
        jobFamilies.map((family) => {
          const familyTracks = tracksByFamily.get(family.id) ?? [];
          const familyEntries = entriesByFamily.get(family.id) ?? [];
          const department = departmentsById.get(family.departmentId);
          const icTrack = familyTracks.find((t) => t.kind === "IC");
          const managerTrack = familyTracks.find((t) => t.kind === "MANAGER");
          // Single-ladder unless a parallel Manager ladder has been added.
          const isSingleLadder = !managerTrack;

          // Matrix columns. A single-ladder family shows one neutral "Title"
          // column; a family that runs both ladders shows the two named
          // columns, and only the Manager column can be removed (deleting it
          // collapses the family back to a single ladder).
          const columns: {
            key: string;
            label: string;
            trackId: string | undefined;
            deletableTrack: CareerTrack | null;
          }[] = isSingleLadder
            ? [{ key: "single", label: "Title", trackId: icTrack?.id, deletableTrack: null }]
            : [
                {
                  key: icTrack!.id,
                  label: icTrack!.name,
                  trackId: icTrack!.id,
                  deletableTrack: null,
                },
                {
                  key: managerTrack!.id,
                  label: managerTrack!.name,
                  trackId: managerTrack!.id,
                  deletableTrack: managerTrack!,
                },
              ];

          // Rows = levels that appear in this family's entries, sorted by
          // the grade's own rank (displayOrder).
          const gradeIds = [...new Set(familyEntries.map((e) => e.jobGradeId))];
          const rows = gradeIds
            .map((id) => gradesById.get(id))
            .filter((g): g is JobGrade => Boolean(g))
            .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));

          return (
            <section
              key={family.id}
              className="rounded-lg border p-4"
              aria-label={`Job family ${family.name}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold">{family.name}</h2>
                  <p className="text-muted-foreground text-xs">
                    {department ? department.name : "—"} · {family.code}
                  </p>
                  {family.description ? (
                    <p className="text-muted-foreground mt-1 text-sm">{family.description}</p>
                  ) : null}
                </div>
                {canManage ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {isSingleLadder ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          runManage(() => addManagerLadderAction({ jobFamilyId: family.id }))
                        }
                        title="Add a parallel manager ladder for roles that have separate IC and manager titles at the same level"
                      >
                        <Plus aria-hidden="true" className="size-4" /> Add manager ladder
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setMappingForFamily(family)}
                      disabled={levels.length === 0}
                    >
                      <Plus aria-hidden="true" className="size-4" /> Add title
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`Edit ${family.name}`}
                      onClick={() => {
                        setEditingFamily(family);
                        setFamilyDialogOpen(true);
                      }}
                    >
                      <Pencil aria-hidden="true" className="size-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      aria-label={`Delete ${family.name}`}
                      onClick={() =>
                        runManage(() => deleteJobFamilyAction({ jobFamilyId: family.id }))
                      }
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </Button>
                  </div>
                ) : null}
              </div>

              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[32rem] border-collapse text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="text-muted-foreground w-20 py-2 pr-2 font-medium">Level</th>
                      {columns.map((col) => (
                        <th key={col.key} className="py-2 pr-2 font-medium">
                          <span className="flex items-center gap-2">
                            {col.label}
                            {canManage && col.deletableTrack ? (
                              <button
                                type="button"
                                aria-label="Remove manager ladder"
                                className="text-muted-foreground hover:text-destructive"
                                onClick={() =>
                                  runManage(() =>
                                    deleteCareerTrackAction({
                                      careerTrackId: col.deletableTrack!.id,
                                    })
                                  )
                                }
                              >
                                <Trash2 aria-hidden="true" className="size-3.5" />
                              </button>
                            ) : null}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={columns.length + 1} className="text-muted-foreground py-3">
                          {levels.length === 0
                            ? "Set up levels first, then add titles."
                            : "No titles yet."}
                        </td>
                      </tr>
                    ) : (
                      rows.map((grade) => (
                        <tr key={grade.id} className="border-b align-top">
                          <td className="py-2 pr-2 font-medium">{grade.code}</td>
                          {columns.map((col) => {
                            const cell = familyEntries.filter(
                              (e) => e.careerTrackId === col.trackId && e.jobGradeId === grade.id
                            );
                            return (
                              <td key={col.key} className="py-2 pr-2">
                                <div className="flex flex-wrap gap-1.5">
                                  {cell.map((entry) => (
                                    <Badge
                                      key={entry.id}
                                      variant="secondary"
                                      className="flex items-center gap-1"
                                    >
                                      {entry.title}
                                      {canManage ? (
                                        <button
                                          type="button"
                                          aria-label={`Remove ${entry.title}`}
                                          className="hover:text-destructive"
                                          onClick={() =>
                                            runManage(() =>
                                              deleteLevelMappingEntryAction({
                                                levelMappingEntryId: entry.id,
                                              })
                                            )
                                          }
                                        >
                                          ×
                                        </button>
                                      ) : null}
                                    </Badge>
                                  ))}
                                  {cell.length === 0 ? (
                                    <span className="text-muted-foreground">—</span>
                                  ) : null}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}

      {canManage ? (
        <>
          <JobFamilyDialog
            open={familyDialogOpen}
            onOpenChange={setFamilyDialogOpen}
            jobFamily={editingFamily}
            departments={departments}
            onSaved={refetch}
          />
          <LevelMappingDialog
            open={mappingForFamily !== null}
            onOpenChange={(open) => {
              if (!open) setMappingForFamily(null);
            }}
            jobFamilyId={mappingForFamily?.id ?? ""}
            tracks={mappingForFamily ? (tracksByFamily.get(mappingForFamily.id) ?? []) : []}
            jobGrades={levels}
            onSaved={refetch}
          />
        </>
      ) : null}
    </div>
  );
}
