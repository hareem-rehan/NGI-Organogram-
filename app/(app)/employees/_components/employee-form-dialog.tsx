"use client";

import { useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Employee } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { z } from "zod";

import { createEmployeeSchema, type CreateEmployeeValues } from "@/lib/validation/employee";
import { createEmployeeAction, updateEmployeeAction } from "@/app/(app)/employees/actions";

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFormError(null);
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

  async function onSubmit(values: SubmittedValues) {
    setFormError(null);
    startTransition(async () => {
      const result = isEdit
        ? await updateEmployeeAction({ employeeId: employee.id, ...values })
        : await createEmployeeAction(values);

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
