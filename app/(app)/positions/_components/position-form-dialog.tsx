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
      positionCode: "",
      departmentId: "",
      jobGradeId: null,
      description: null,
      location: null,
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
  departmentsRef.current = departments;

  useEffect(() => {
    if (open && !wasOpen.current) {
      const currentPosition = positionRef.current;
      const currentDepartments = departmentsRef.current;
      setFormError(null);
      setReportsToQuery("");
      reset({
        title: currentPosition?.title ?? "",
        positionCode: currentPosition?.positionCode ?? "",
        departmentId: currentPosition?.departmentId ?? currentDepartments[0]?.id ?? "",
        jobGradeId: currentPosition?.jobGradeId ?? null,
        description: currentPosition?.description ?? null,
        location: currentPosition?.location ?? null,
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
  const jobGradeId = watch("jobGradeId");
  const primaryReportsToPositionId = watch("primaryReportsToPositionId");

  const hasRoot = allPositions.some((candidate) => candidate.primaryReportsToPositionId === null);

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
            positionCode: values.positionCode,
            departmentId: values.departmentId,
            jobGradeId: values.jobGradeId,
            description: values.description,
            location: values.location,
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

          <Field
            label="Code"
            required
            error={errors.positionCode?.message}
            hint="Trimmed and uppercased automatically."
          >
            {(fieldProps) => <Input {...fieldProps} {...register("positionCode")} />}
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
            label="Job grade"
            error={undefined}
            hint="Optional — independent of organizational level."
          >
            {(fieldProps) => (
              <Select
                {...fieldProps}
                value={jobGradeId ?? ""}
                onChange={(event) =>
                  setValue("jobGradeId", event.target.value || null, { shouldValidate: true })
                }
              >
                <option value="">No job grade</option>
                {jobGrades.map((grade) => (
                  <option key={grade.id} value={grade.id}>
                    {grade.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Location" error={errors.location?.message}>
            {(fieldProps) => <Input {...fieldProps} {...register("location")} />}
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
