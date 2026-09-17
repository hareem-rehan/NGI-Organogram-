"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Department, JobGrade, Position } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createPositionSchema, type CreatePositionValues } from "@/lib/validation/position";
import { JOB_GRADE_SCALE } from "@/lib/domain/job-grade-mapping";
import { createPositionAction, updatePositionAction } from "@/app/(app)/positions/actions";

interface PositionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position: Position | null;
  departments: readonly Department[];
  jobGrades: readonly JobGrade[];
  /** Only relevant when creating (used to populate the Reports-To combobox and to detect whether a root already exists). */
  allPositions: readonly Position[];
  onSaved: () => void;
}

type FormValues = CreatePositionValues;

/**
 * The managers a new position may report to, scoped to its own department.
 *
 * A position reports within its own department, and a department's first
 * or top role reports up to the ROOT (the CEO — the single position with
 * no manager of its own). Everything else is noise in the picker: a
 * brand-new "Client Delivery Services" role should see only the CEO, not
 * every HR position. Passing an empty `departmentId` (no department chosen
 * yet) applies no department scope. `query` filters by title or code.
 *
 * This is a relevance filter for the UI only — the server still
 * re-validates the chosen manager on submit, so narrowing here can never
 * be a security assumption.
 */
export function scopeReportsToOptions(
  allPositions: readonly Position[],
  departmentId: string,
  query: string
): ComboboxOption[] {
  const q = query.trim().toLowerCase();
  return allPositions
    .filter((candidate) => {
      const inScope =
        departmentId === "" ||
        candidate.departmentId === departmentId ||
        candidate.primaryReportsToPositionId === null;
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
      description: `${candidate.positionCode} · Level ${candidate.organizationalLevel}`,
    }));
}

/**
 * Create/edit dialog. When creating, the Reports-To combobox is part of
 * the same form (a brand-new leaf position has no descendants to
 * recalculate, so the lighter-weight inline picker is appropriate). When
 * editing, Reports-To is intentionally NOT here — changing an existing
 * position's place in the hierarchy goes through the dedicated
 * `PositionMoveDialog`, which surfaces descendant-recalculation feedback
 * (docs/IMPLEMENTATION_PLAN.md Phase 5).
 */
export function PositionFormDialog({
  open,
  onOpenChange,
  position,
  departments,
  jobGrades,
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
    resolver: zodResolver(createPositionSchema),
    defaultValues: {
      title: "",
      departmentId: "",
      jobGradeCode: null,
      jobGradeName: null,
      description: null,
      primaryReportsToPositionId: null,
    },
  });

  // Resets the form exactly once per dialog-open transition (tracked via
  // `wasOpen`, not via `open`/`position`/`departments` in the dependency
  // array directly) — `departments` in particular loads asynchronously
  // and, if included as a normal dependency, a real re-render once that
  // fetch resolves WHILE the dialog is already open would re-run this
  // effect and silently wipe out whatever the user had already typed
  // into Title/Code. Read the current `position`/`departments` via refs
  // instead so the reset still uses fresh data without re-triggering on
  // every one of their changes.
  const wasOpen = useRef(false);
  const positionRef = useRef(position);
  positionRef.current = position;
  const departmentsRef = useRef(departments);
  const jobGradesRef = useRef(jobGrades);
  departmentsRef.current = departments;
  jobGradesRef.current = jobGrades;

  useEffect(() => {
    if (open && !wasOpen.current) {
      const currentPosition = positionRef.current;
      const currentDepartments = departmentsRef.current;
      setFormError(null);
      setReportsToQuery("");
      reset({
        title: currentPosition?.title ?? "",
        departmentId: currentPosition?.departmentId ?? currentDepartments[0]?.id ?? "",
        jobGradeCode: currentPosition?.jobGradeId
          ? (jobGradesRef.current.find((g) => g.id === currentPosition.jobGradeId)?.code ?? null)
          : null,
        jobGradeName: currentPosition?.jobGradeId
          ? (jobGradesRef.current.find((g) => g.id === currentPosition.jobGradeId)?.name ?? null)
          : null,
        description: currentPosition?.description ?? null,
        primaryReportsToPositionId: null,
      });
    }
    wasOpen.current = open;
  }, [open, reset]);

  // If the dialog opened before `departments` had loaded, backfill the
  // department default once real data arrives — but only while the field
  // is still untouched (empty), never overwriting a value the user (or a
  // prior reset) already set.
  useEffect(() => {
    if (open && departments.length > 0 && !position && !watch("departmentId")) {
      setValue("departmentId", departments[0]?.id ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, departments]);

  const departmentId = watch("departmentId");
  const jobGradeCode = watch("jobGradeCode");
  const jobGradeName = watch("jobGradeName");
  const primaryReportsToPositionId = watch("primaryReportsToPositionId");

  const hasRoot = allPositions.some((candidate) => candidate.primaryReportsToPositionId === null);

  // Levels are per-department: the code and its numeric rank are
  // universal, but the NAME belongs to a department (Engineering's L7 can
  // be "Principal Engineer" while HR's L7 is "HR Lead"). This maps a
  // (departmentId, code) to the name that department already uses, so the
  // dropdown labels and the "Level name" field pre-fill with the selected
  // department's own wording.
  const deptGradeName = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const g of jobGrades) {
      if (g.departmentId) byKey.set(`${g.departmentId}:${g.code}`, g.name);
    }
    return byKey;
  }, [jobGrades]);

  const scaleNameByCode = useMemo(
    () => new Map(JOB_GRADE_SCALE.map((g) => [g.code, g.name] as const)),
    []
  );

  // The name to seed the "Level name" field with when a level is picked
  // for a department: the department's existing name for that level, else
  // the standard scale default.
  function defaultLevelName(deptId: string, code: string): string {
    return deptGradeName.get(`${deptId}:${code}`) ?? scaleNameByCode.get(code) ?? "";
  }

  // The level dropdown offers the whole standard L2–L18 scale (a
  // constant, so it works even on a company that has no grade rows yet),
  // labeled with the SELECTED department's name for each level where it
  // has defined one, plus any grade that department already has whose
  // code is not on the scale. Picking one and saving creates/updates the
  // matching grade for that department on first use (see
  // lib/services/job-grade.service.ts). Value is the code, so it is
  // resolvable without a pre-existing id.
  const levelOptions = useMemo(() => {
    const byCode = new Map<string, { code: string; label: string }>();
    for (const g of JOB_GRADE_SCALE) {
      const name = deptGradeName.get(`${departmentId}:${g.code}`) ?? g.name;
      byCode.set(g.code, { code: g.code, label: `${g.code} — ${name}` });
    }
    for (const g of jobGrades) {
      if (g.departmentId === departmentId && !byCode.has(g.code)) {
        byCode.set(g.code, { code: g.code, label: `${g.code} — ${g.name}` });
      }
    }
    return [...byCode.values()];
  }, [jobGrades, deptGradeName, departmentId]);

  const reportsToOptions: ComboboxOption[] = useMemo(
    () => scopeReportsToOptions(allPositions, departmentId, reportsToQuery),
    [allPositions, reportsToQuery, departmentId]
  );

  async function onSubmit(values: FormValues) {
    setFormError(null);
    startTransition(async () => {
      const result = isEdit
        ? await updatePositionAction({
            positionId: position.id,
            title: values.title,
            departmentId: values.departmentId,
            jobGradeCode: values.jobGradeCode,
            jobGradeName: values.jobGradeName,
            description: values.description,
          })
        : await createPositionAction(values);

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

          <Field label="Title" required error={errors.title?.message}>
            {(fieldProps) => <Input {...fieldProps} {...register("title")} autoFocus />}
          </Field>

          <Field label="Department" required error={errors.departmentId?.message}>
            {(fieldProps) => (
              <Select
                {...fieldProps}
                value={departmentId}
                onChange={(event) => {
                  const newDept = event.target.value;
                  setValue("departmentId", newDept, { shouldValidate: true });
                  // The level name is per-department, so re-seed it for the
                  // newly-selected department when a level is already chosen.
                  if (jobGradeCode) {
                    setValue("jobGradeName", defaultLevelName(newDept, jobGradeCode));
                  }
                  // The Reports-To picker is scoped to the department, so a
                  // manager chosen for the old department may no longer be
                  // offered. Clear it unless it is still in scope (same
                  // department, or the root CEO which is always allowed).
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
            label="Level"
            error={undefined}
            hint="Sets where this role sits on the organization chart. Picking a level creates it for your company if it doesn't exist yet."
          >
            {(fieldProps) => (
              <Select
                {...fieldProps}
                value={jobGradeCode ?? ""}
                onChange={(event) => {
                  const code = event.target.value || null;
                  setValue("jobGradeCode", code, { shouldValidate: true });
                  // Seed the editable name with what this department already
                  // calls the level (or the scale default) so the common
                  // case needs no typing, while still allowing a rename.
                  setValue("jobGradeName", code ? defaultLevelName(departmentId, code) : null);
                }}
              >
                <option value="">No level</option>
                {levelOptions.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {jobGradeCode ? (
            <Field
              label="Level name"
              hint="What this department calls this level. Saving updates the name for this department only."
            >
              {(fieldProps) => (
                <Input
                  {...fieldProps}
                  value={jobGradeName ?? ""}
                  onChange={(event) => setValue("jobGradeName", event.target.value || null)}
                />
              )}
            </Field>
          ) : null}

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
