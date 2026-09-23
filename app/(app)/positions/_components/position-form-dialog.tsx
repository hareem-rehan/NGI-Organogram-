"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import type {
  CareerTrack,
  Department,
  JobFamily,
  JobGrade,
  LevelMappingEntry,
  Position,
} from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createPositionAction, updatePositionAction } from "@/app/(app)/positions/actions";

interface PositionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position: Position | null;
  departments: readonly Department[];
  jobGrades: readonly JobGrade[];
  jobFamilies: readonly JobFamily[];
  careerTracks: readonly CareerTrack[];
  levelMappingEntries: readonly LevelMappingEntry[];
  /** Only relevant when creating (used to populate the Reports-To combobox and to detect whether a root already exists). */
  allPositions: readonly Position[];
  onSaved: () => void;
}

interface FormValues {
  title: string;
  departmentId: string;
  jobFamilyId: string | null;
  careerTrackId: string | null;
  jobGradeId: string | null;
  description: string | null;
  primaryReportsToPositionId: string | null;
}

/**
 * The managers a new position may report to, scoped to its OWN department:
 * once a department is chosen, only that department's positions are offered
 * — never positions from other departments. Passing an empty `departmentId`
 * applies no department scope. `query` filters by title or code.
 *
 * Leaving Reports-To empty makes the position a root (the department's/
 * company's top), so a department's first role does not need a cross-
 * department manager in the list.
 *
 * This is a relevance filter for the UI only — the server still
 * re-validates the chosen manager on submit, so narrowing here can never
 * be a security assumption. Reports-To is entirely independent of the
 * career-framework fields above it in the form.
 */
export function scopeReportsToOptions(
  allPositions: readonly Position[],
  departmentId: string,
  query: string,
  jobFamilyNameById?: ReadonlyMap<string, string>
): ComboboxOption[] {
  const q = query.trim().toLowerCase();
  return allPositions
    .filter((candidate) => {
      // When a department is chosen, only that department's own positions are
      // offered as managers — no positions from other departments. With no
      // department chosen yet, every position is in scope. (Leaving Reports-To
      // empty still makes the position a root; the server re-validates.)
      const inScope = departmentId === "" || candidate.departmentId === departmentId;
      if (!inScope) return false;
      return (
        q === "" ||
        candidate.title.toLowerCase().includes(q) ||
        candidate.positionCode.toLowerCase().includes(q)
      );
    })
    .map((candidate) => ({
      value: candidate.id,
      label: candidate.title,
      description: reportsToDescription(candidate, jobFamilyNameById),
    }));
}

/**
 * The secondary line under a reports-to option. Shows the position's job
 * family only — never the organizational level (removed as noise) nor the
 * internal position code. Returns undefined when the position has no family,
 * so the option shows just its title.
 */
export function reportsToDescription(
  candidate: Pick<Position, "jobFamilyId">,
  jobFamilyNameById?: ReadonlyMap<string, string>
): string | undefined {
  return candidate.jobFamilyId
    ? (jobFamilyNameById?.get(candidate.jobFamilyId) ?? undefined)
    : undefined;
}

/**
 * Create/edit dialog. The fields step down through the career framework —
 * Department → Job Family → Career Track → Level → Title — where each
 * choice filters the next, and Title offers the eligible titles configured
 * for that (family, track, level) cell without forcing one. NONE of this
 * sets reporting: Reports-To (create only) is a separate, independent
 * picker. When editing, Reports-To is intentionally NOT here — changing an
 * existing position's place in the hierarchy goes through the dedicated
 * `PositionMoveDialog`.
 */
export function PositionFormDialog({
  open,
  onOpenChange,
  position,
  departments,
  jobGrades,
  jobFamilies,
  careerTracks,
  levelMappingEntries,
  allPositions,
  onSaved,
}: PositionFormDialogProps) {
  const isEdit = position !== null;
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [reportsToQuery, setReportsToQuery] = useState("");

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      title: "",
      departmentId: "",
      jobFamilyId: null,
      careerTrackId: null,
      jobGradeId: null,
      description: null,
      primaryReportsToPositionId: null,
    },
  });

  // Reset exactly once per dialog-open transition (see the departments
  // backfill note below) — read live props via refs so async-loaded data
  // is used without re-running this effect and wiping typed input.
  const wasOpen = useRef(false);
  const positionRef = useRef(position);
  positionRef.current = position;
  const departmentsRef = useRef(departments);
  departmentsRef.current = departments;

  useEffect(() => {
    if (open && !wasOpen.current) {
      const currentPosition = positionRef.current;
      const currentDepartments = departmentsRef.current;
      setFormError(null);
      setReportsToQuery("");
      reset({
        title: currentPosition?.title ?? "",
        departmentId: currentPosition?.departmentId ?? currentDepartments[0]?.id ?? "",
        jobFamilyId: currentPosition?.jobFamilyId ?? null,
        careerTrackId: currentPosition?.careerTrackId ?? null,
        jobGradeId: currentPosition?.jobGradeId ?? null,
        description: currentPosition?.description ?? null,
        primaryReportsToPositionId: null,
      });
    }
    wasOpen.current = open;
  }, [open, reset]);

  // Backfill the department default if the dialog opened before
  // `departments` loaded — only while the field is still untouched.
  useEffect(() => {
    if (open && departments.length > 0 && !position && !watch("departmentId")) {
      setValue("departmentId", departments[0]?.id ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, departments]);

  const departmentId = watch("departmentId");
  const jobFamilyId = watch("jobFamilyId");
  const careerTrackId = watch("careerTrackId");
  const jobGradeId = watch("jobGradeId");
  const primaryReportsToPositionId = watch("primaryReportsToPositionId");

  const hasRoot = allPositions.some((candidate) => candidate.primaryReportsToPositionId === null);

  // Level options: the company's levels, each shown as its code plus the
  // level's role name (e.g. "L7 — Lead / Principal") so the picker reads as
  // the career ladder, not opaque codes. One option per code, preferring
  // the shared (company-wide) grade over any per-department duplicate,
  // sorted by the grade's own numeric rank.
  const gradeOptions = useMemo(() => {
    const byCode = new Map<string, JobGrade>();
    for (const g of jobGrades) {
      const existing = byCode.get(g.code);
      if (!existing || (existing.departmentId && !g.departmentId)) byCode.set(g.code, g);
    }
    return [...byCode.values()].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  }, [jobGrades]);

  // Job families in the selected department; tracks within the selected
  // family. Both optional — a position need not be classified.
  const familyOptions = useMemo(
    () => jobFamilies.filter((f) => f.departmentId === departmentId),
    [jobFamilies, departmentId]
  );
  const trackOptions = useMemo(
    () => careerTracks.filter((t) => t.jobFamilyId === jobFamilyId),
    [careerTracks, jobFamilyId]
  );
  // Only families that run a parallel Manager ladder need a ladder choice.
  // A single-ladder family (the common case) hides the picker and classifies
  // the position onto its base (IC) ladder automatically.
  const hasManagerLadder = useMemo(
    () => trackOptions.some((t) => t.kind === "MANAGER"),
    [trackOptions]
  );
  useEffect(() => {
    if (!jobFamilyId) return;
    if (!hasManagerLadder) {
      // Single ladder: pin to the family's base (IC) ladder if it exists,
      // otherwise leave unset — the family classification is what matters.
      const base = trackOptions.find((t) => t.kind === "IC");
      setValue("careerTrackId", base?.id ?? null);
    }
  }, [jobFamilyId, hasManagerLadder, trackOptions, setValue]);

  // Titles configured for the chosen (family, track, level) cell of the
  // career matrix — offered as suggestions, never enforced.
  const titleSuggestions = useMemo(() => {
    if (!jobFamilyId || !careerTrackId || !jobGradeId) return [];
    return levelMappingEntries
      .filter(
        (e) =>
          e.jobFamilyId === jobFamilyId &&
          e.careerTrackId === careerTrackId &&
          e.jobGradeId === jobGradeId
      )
      .map((e) => e.title);
  }, [levelMappingEntries, jobFamilyId, careerTrackId, jobGradeId]);

  const jobFamilyNameById = useMemo(
    () => new Map(jobFamilies.map((f) => [f.id, f.name])),
    [jobFamilies]
  );
  const reportsToOptions: ComboboxOption[] = useMemo(
    () => scopeReportsToOptions(allPositions, departmentId, reportsToQuery, jobFamilyNameById),
    [allPositions, reportsToQuery, departmentId, jobFamilyNameById]
  );

  function onSubmit(values: FormValues) {
    setFormError(null);
    startTransition(async () => {
      const result = isEdit
        ? await updatePositionAction({
            positionId: position.id,
            title: values.title,
            departmentId: values.departmentId,
            jobGradeId: values.jobGradeId,
            jobFamilyId: values.jobFamilyId,
            careerTrackId: values.careerTrackId,
            description: values.description,
          })
        : await createPositionAction({
            title: values.title,
            departmentId: values.departmentId,
            jobGradeId: values.jobGradeId,
            jobFamilyId: values.jobFamilyId,
            careerTrackId: values.careerTrackId,
            description: values.description,
            primaryReportsToPositionId: values.primaryReportsToPositionId,
          });

      if (!result.ok) {
        setFormError(result.error);
        if (result.fieldErrors) {
          for (const [field, message] of Object.entries(result.fieldErrors)) {
            if (field in values) {
              setError(field as keyof FormValues, { message });
            }
          }
        }
        return;
      }

      onOpenChange(false);
      onSaved();
    });
  }

  const busy = isSubmitting || pending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={isEdit ? `Edit ${position.title}` : "Add Position"}
        description={
          isEdit
            ? "Update this position's details. To change who it reports to, use “Change Reports-To” instead."
            : "Create a new position."
        }
      >
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          {formError ? (
            <p role="alert" className="text-destructive text-sm font-medium">
              {formError}
            </p>
          ) : null}

          <Field label="Department" required error={errors.departmentId?.message}>
            {(fieldProps) => (
              <Select
                {...fieldProps}
                value={departmentId}
                onChange={(event) => {
                  const newDept = event.target.value;
                  setValue("departmentId", newDept, { shouldValidate: true });
                  // Job family (and therefore track) is scoped to the
                  // department, so a family from the old department no longer
                  // applies — clear both.
                  setValue("jobFamilyId", null);
                  setValue("careerTrackId", null);
                  // Reports-To is department-scoped too; drop a now-out-of-scope
                  // manager (keep the root CEO, always allowed).
                  const chosen = allPositions.find((p) => p.id === primaryReportsToPositionId);
                  if (
                    chosen &&
                    chosen.departmentId !== newDept &&
                    chosen.primaryReportsToPositionId !== null
                  ) {
                    setValue("primaryReportsToPositionId", null);
                  }
                }}
              >
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Job family"
            hint="Career specialization (optional). Independent of reporting."
          >
            {(fieldProps) => (
              <Select
                {...fieldProps}
                value={jobFamilyId ?? ""}
                onChange={(event) => {
                  setValue("jobFamilyId", event.target.value || null);
                  setValue("careerTrackId", null);
                }}
              >
                <option value="">
                  {familyOptions.length === 0 ? "None for this department" : "None"}
                </option>
                {familyOptions.map((family) => (
                  <option key={family.id} value={family.id}>
                    {family.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {hasManagerLadder ? (
            <Field label="Career track" hint="IC or Manager ladder (optional).">
              {(fieldProps) => (
                <Select
                  {...fieldProps}
                  value={careerTrackId ?? ""}
                  onChange={(event) => setValue("careerTrackId", event.target.value || null)}
                >
                  <option value="">None</option>
                  {trackOptions.map((track) => (
                    <option key={track.id} value={track.id}>
                      {track.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}

          <Field
            label="Level"
            hint="Career seniority (e.g. L7). Does not affect who reports to whom."
          >
            {(fieldProps) => (
              <Select
                {...fieldProps}
                value={jobGradeId ?? ""}
                onChange={(event) => setValue("jobGradeId", event.target.value || null)}
              >
                <option value="">No level</option>
                {gradeOptions.map((grade) => (
                  <option key={grade.id} value={grade.id}>
                    {grade.name ? `${grade.code} — ${grade.name}` : grade.code}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Title"
            required
            error={errors.title?.message}
            hint={
              titleSuggestions.length > 0
                ? "Suggestions come from the career matrix for the selected family, track and level."
                : undefined
            }
          >
            {(fieldProps) => (
              <>
                <Input
                  {...fieldProps}
                  {...register("title", { required: "Title is required." })}
                  list="position-title-suggestions"
                  autoFocus
                />
                {titleSuggestions.length > 0 ? (
                  <datalist id="position-title-suggestions">
                    {titleSuggestions.map((suggestion) => (
                      <option key={suggestion} value={suggestion} />
                    ))}
                  </datalist>
                ) : null}
              </>
            )}
          </Field>

          <Field label="Description" error={errors.description?.message}>
            {(fieldProps) => <Textarea {...fieldProps} {...register("description")} rows={3} />}
          </Field>

          {!isEdit ? (
            <Field
              label="Reports to"
              required={hasRoot}
              error={undefined}
              hint={hasRoot ? undefined : "Leave empty to create the company's root position."}
            >
              {(fieldProps) => (
                <Combobox
                  {...fieldProps}
                  value={primaryReportsToPositionId ?? null}
                  onChange={(value) =>
                    setValue("primaryReportsToPositionId", value, { shouldValidate: true })
                  }
                  options={reportsToOptions}
                  query={reportsToQuery}
                  onQueryChange={setReportsToQuery}
                  placeholder={hasRoot ? "Search positions…" : "None (root position)"}
                  aria-label="Reports to"
                />
              )}
            </Field>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : isEdit ? "Save changes" : "Create position"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
