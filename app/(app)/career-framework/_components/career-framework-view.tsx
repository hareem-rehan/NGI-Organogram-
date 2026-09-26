"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
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
  const [, startTransition] = useTransition();

  const [familyDialogOpen, setFamilyDialogOpen] = useState(false);
  const [editingFamily, setEditingFamily] = useState<JobFamily | null>(null);
  const [mappingForFamily, setMappingForFamily] = useState<JobFamily | null>(null);

  const departmentsById = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments]);
  // Only used to order titles by their level's rank — levels are no longer
  // shown on this page (they are managed in Settings, docs/DECISIONS.md D23).
  const gradeRankById = useMemo(
    () => new Map(levels.map((g) => [g.id, g.displayOrder ?? 0])),
    [levels]
  );

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
          Sub-divisions and their Individual Contributor / Manager titles describe career
          progression — they never set who reports to whom. The organogram is built from reporting
          relationships alone.
        </p>
        {canManage ? (
          <Button
            onClick={() => {
              setEditingFamily(null);
              setFamilyDialogOpen(true);
            }}
          >
            <Plus aria-hidden="true" className="size-4" /> Add Sub-division
          </Button>
        ) : null}
      </div>

      {actionError ? (
        <p role="alert" className="text-destructive text-sm font-medium">
          {actionError}
        </p>
      ) : null}

      {canManage && levels.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
          Titles are recorded at a level. Set up your levels in{" "}
          <Link href="/settings" className="underline">
            Settings
          </Link>{" "}
          first, then you can add titles here.
        </p>
      ) : null}

      {jobFamilies.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          No sub-divisions yet. {canManage ? "Add one to start recording career titles." : ""}
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

          // Columns: a single-ladder family shows one neutral "Titles" list; a
          // family running both ladders shows the two named lists, and only the
          // Manager list can be removed (collapsing back to a single ladder).
          const columns: {
            key: string;
            label: string;
            trackId: string | undefined;
            deletableTrack: CareerTrack | null;
          }[] = isSingleLadder
            ? [{ key: "single", label: "Titles", trackId: icTrack?.id, deletableTrack: null }]
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

          // Titles for a column, ordered by their level's rank (so the list
          // still reads junior → senior) then alphabetically — the level
          // itself is not shown here.
          const titlesForColumn = (trackId: string | undefined) =>
            familyEntries
              .filter((e) => e.careerTrackId === trackId)
              .sort(
                (a, b) =>
                  (gradeRankById.get(a.jobGradeId) ?? 0) - (gradeRankById.get(b.jobGradeId) ?? 0) ||
                  a.title.localeCompare(b.title)
              );

          return (
            <section
              key={family.id}
              className="rounded-lg border p-4"
              aria-label={`Sub-division ${family.name}`}
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
                        title="Add a parallel manager ladder for roles that have separate IC and manager titles"
                      >
                        <Plus aria-hidden="true" className="size-4" /> Add manager ladder
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setMappingForFamily(family)}
                      disabled={levels.length === 0}
                      title={levels.length === 0 ? "Set up levels in Settings first" : undefined}
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

              <div className="mt-4 flex flex-col gap-4 sm:flex-row">
                {columns.map((col) => {
                  const colTitles = titlesForColumn(col.trackId);
                  return (
                    <div key={col.key} className="min-w-0 flex-1">
                      <div className="mb-2 flex items-center gap-2 border-b pb-1">
                        <h3 className="text-muted-foreground text-sm font-medium">{col.label}</h3>
                        {canManage && col.deletableTrack ? (
                          <button
                            type="button"
                            aria-label="Remove manager ladder"
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() =>
                              runManage(() =>
                                deleteCareerTrackAction({ careerTrackId: col.deletableTrack!.id })
                              )
                            }
                          >
                            <Trash2 aria-hidden="true" className="size-3.5" />
                          </button>
                        ) : null}
                      </div>
                      {colTitles.length === 0 ? (
                        <p className="text-muted-foreground text-sm">No titles yet.</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {colTitles.map((entry) => (
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
                        </div>
                      )}
                    </div>
                  );
                })}
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
