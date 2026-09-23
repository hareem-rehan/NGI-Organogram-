"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Employee } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { z } from "zod";

import { createEmployeeSchema, type CreateEmployeeValues } from "@/lib/validation/employee";
import {
  createEmployeeAction,
  listEligiblePositionsAction,
  updateEmployeeAction,
} from "@/app/(app)/employees/actions";
import type { EligiblePosition } from "@/lib/repositories/position.repository";

interface EmployeeFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create mode. */
  employee: Employee | null;
  onSaved: () => void;
}

type FormValues = z.input<typeof createEmployeeSchema>;
type SubmittedValues = CreateEmployeeValues;

function toDateInputValue(date: Date | null | undefined): string {
  if (!date) return "";
  return date.toISOString().slice(0, 10);
}

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Create/edit form. Deliberately has no field for manager, department,
 * organizational level, job grade, salary, application role, or SSO
 * access — none of those exist as employee-owned data (they're either
 * derived from the active position assignment, or out of scope entirely
 * per docs/PROJECT_SPEC.md's privacy requirements). Employment status is
 * intentionally NOT editable here either — status transitions go through
 * their own guided actions (Terminate, or the status control on the
 * details page), so a plain detail correction can never accidentally
 * also end someone's employment.
 *
 * On CREATE only, an OPTIONAL "Assign to a vacant position" section lets HR
 * put a new hire straight into an open seat. It is entirely optional — left
 * blank, the employee is created unassigned. When a position is chosen the
 * create + assignment happen atomically server-side
 * (createEmployeeWithOptionalAssignment); the position list is the same
 * server-eligibility-checked set the standalone Assign flow uses, so it only
 * offers seats vacant on the chosen start date.
 */
export function EmployeeFormDialog({
  open,
  onOpenChange,
  employee,
  onSaved,
}: EmployeeFormDialogProps) {
  const isEdit = employee !== null;
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Optional first-assignment state (create mode only). Kept outside RHF —
  // it is not part of the employee record, and its eligibility is resolved
  // server-side — so it never complicates the base-field validation.
  const [assignPositionId, setAssignPositionId] = useState<string | null>(null);
  const [assignStartDate, setAssignStartDate] = useState<string>(todayInputValue());
  const [positionQuery, setPositionQuery] = useState("");
  const [positionOptions, setPositionOptions] = useState<EligiblePosition[]>([]);
  const [loadingPositions, setLoadingPositions] = useState(false);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, SubmittedValues>({
    resolver: zodResolver(createEmployeeSchema),
    defaultValues: {
      employeeCode: "",
      firstName: "",
      lastName: "",
      preferredName: null,
      workEmail: null,
      joiningDate: null,
    },
  });

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setFormError(null);
    setAssignmentError(null);
    setAssignPositionId(null);
    setPositionQuery("");
    setAssignStartDate(todayInputValue());
    /* eslint-enable react-hooks/set-state-in-effect */
    reset({
      employeeCode: employee?.employeeCode ?? "",
      firstName: employee?.firstName ?? "",
      lastName: employee?.lastName ?? "",
      preferredName: employee?.preferredName ?? null,
      workEmail: employee?.workEmail ?? null,
      joiningDate: employee?.joiningDate ?? null,
    });
    // Reset only depends on the open transition and which record is being
    // edited — not on anything that loads asynchronously after open, so
    // this form doesn't need the ref-gated pattern
    // app/(app)/positions/_components/position-form-dialog.tsx required
    // (docs/DECISIONS.md A16) — there is no async default here to race.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, employee]);

  // Eligible (vacant, active-department, non-archived) positions for the
  // optional assignment, re-queried when the search or start date changes —
  // create mode only. Mirrors AssignPositionDialog so the two flows can never
  // disagree on what "vacant" means.
  useEffect(() => {
    if (!open || isEdit) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingPositions(true);
    let cancelled = false;
    void (async () => {
      const result = await listEligiblePositionsAction({
        search: positionQuery || undefined,
        effectiveDate: assignStartDate ? new Date(assignStartDate) : undefined,
      });
      if (cancelled) return;
      setLoadingPositions(false);
      if (result.ok) setPositionOptions(result.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, isEdit, positionQuery, assignStartDate]);

  const positionComboboxOptions: ComboboxOption[] = useMemo(
    () =>
      positionOptions.map((eligible) => ({
        value: eligible.position.id,
        label: eligible.position.title,
        description: `${eligible.position.positionCode} · ${eligible.departmentName} · Level ${eligible.position.organizationalLevel}`,
      })),
    [positionOptions]
  );

  async function onSubmit(values: SubmittedValues) {
    setFormError(null);
    setAssignmentError(null);

    // A chosen position needs a start date (mirrors the server's
    // createEmployeeWithAssignmentSchema refinement) — guard before the
    // round-trip so the message lands on the right control.
    if (!isEdit && assignPositionId && !assignStartDate) {
      setAssignmentError("Start date is required when assigning to a position.");
      return;
    }

    startTransition(async () => {
      const result = isEdit
        ? await updateEmployeeAction({ employeeId: employee.id, ...values })
        : await createEmployeeAction({
            ...values,
            assignmentPositionId: assignPositionId,
            assignmentStartDate: assignPositionId ? assignStartDate : null,
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
        title={isEdit ? `Edit ${employee.firstName} ${employee.lastName}` : "Add Employee"}
        description={isEdit ? "Update this employee's details." : "Create a new employee record."}
      >
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          {formError ? (
            <p role="alert" className="text-destructive text-sm font-medium">
              {formError}
            </p>
          ) : null}

          <Field
            label="Employee code"
            required
            error={errors.employeeCode?.message}
            hint="Trimmed and uppercased automatically."
          >
            {(fieldProps) => <Input {...fieldProps} {...register("employeeCode")} autoFocus />}
          </Field>

          <Field label="First name" required error={errors.firstName?.message}>
            {(fieldProps) => <Input {...fieldProps} {...register("firstName")} />}
          </Field>

          <Field label="Last name" required error={errors.lastName?.message}>
            {(fieldProps) => <Input {...fieldProps} {...register("lastName")} />}
          </Field>

          <Field label="Preferred name" error={errors.preferredName?.message}>
            {(fieldProps) => <Input {...fieldProps} {...register("preferredName")} />}
          </Field>

          <Field label="Work email" error={errors.workEmail?.message}>
            {(fieldProps) => <Input {...fieldProps} type="email" {...register("workEmail")} />}
          </Field>

          <Field label="Joining date" error={errors.joiningDate?.message}>
            {(fieldProps) => (
              <Input
                {...fieldProps}
                type="date"
                defaultValue={toDateInputValue(employee?.joiningDate)}
                {...register("joiningDate")}
              />
            )}
          </Field>

          {!isEdit ? (
            <fieldset className="border-border flex flex-col gap-4 rounded-md border p-4">
              <legend className="text-muted-foreground px-1 text-sm font-medium">
                Assign to a position (optional)
              </legend>

              <Field
                label="Position"
                hint="Leave empty to create an unassigned employee. Only seats vacant on the start date are shown."
              >
                {(fieldProps) => (
                  <Combobox
                    {...fieldProps}
                    value={assignPositionId}
                    onChange={setAssignPositionId}
                    options={positionComboboxOptions}
                    query={positionQuery}
                    onQueryChange={setPositionQuery}
                    loading={loadingPositions}
                    emptyMessage="No vacant positions for this start date."
                    placeholder="Search positions…"
                    aria-label="Position"
                  />
                )}
              </Field>

              {assignPositionId ? (
                <Field label="Start date" required error={assignmentError ?? undefined}>
                  {(fieldProps) => (
                    <Input
                      {...fieldProps}
                      type="date"
                      value={assignStartDate}
                      onChange={(event) => setAssignStartDate(event.target.value)}
                    />
                  )}
                </Field>
              ) : null}
            </fieldset>
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
              {busy ? "Saving…" : isEdit ? "Save changes" : "Create employee"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
