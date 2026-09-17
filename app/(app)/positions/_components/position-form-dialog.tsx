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
  const primaryReportsToPositionId = watch("primaryReportsToPositionId");

  const hasRoot = allPositions.some((candidate) => candidate.primaryReportsToPositionId === null);

  // The level dropdown offers the whole standard L2–L18 scale (a
  // constant, so it works even on a company that has no grade rows yet),
  // plus any grade already in the database whose code is not on that
  // scale. Picking one and saving creates the matching grade on first use
  // (see lib/services/job-grade.service.ts). Value is the code, so it is
  // resolvable without a pre-existing id.
  const levelOptions = useMemo(() => {
    const byCode = new Map<string, { code: string; label: string }>();
    for (const g of JOB_GRADE_SCALE) {
      byCode.set(g.code, { code: g.code, label: `${g.code} — ${g.name}` });
    }
    for (const g of jobGrades) {
      if (!byCode.has(g.code)) byCode.set(g.code, { code: g.code, label: `${g.code} — ${g.name}` });
    }
    return [...byCode.values()];
  }, [jobGrades]);

  const reportsToOptions: ComboboxOption[] = useMemo(() => {
    const candidates = allPositions.filter(
      (candidate) =>
        reportsToQuery.trim() === "" ||
        candidate.title.toLowerCase().includes(reportsToQuery.toLowerCase()) ||
        candidate.positionCode.toLowerCase().includes(reportsToQuery.toLowerCase())
    );
    return candidates.map((candidate) => ({
      value: candidate.id,
      label: candidate.title,
      description: `${candidate.positionCode} · Level ${candidate.organizationalLevel}`,
    }));
  }, [allPositions, reportsToQuery]);

  async function onSubmit(values: FormValues) {
    setFormError(null);
    startTransition(async () => {
      const result = isEdit
        ? await updatePositionAction({
            positionId: position.id,
            title: values.title,
            departmentId: values.departmentId,
            jobGradeCode: values.jobGradeCode,
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
                onChange={(event) =>
                  setValue("departmentId", event.target.value, { shouldValidate: true })
                }
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
                onChange={(event) =>
                  setValue("jobGradeCode", event.target.value || null, { shouldValidate: true })
                }
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
