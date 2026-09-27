"use client";

import { useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Department } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ColorSwatchPicker } from "@/components/patterns/color-swatch-picker";
import { createDepartmentSchema, type CreateDepartmentValues } from "@/lib/validation/department";
import {
  createDepartmentAction,
  moveDepartmentAction,
  updateDepartmentAction,
} from "@/app/(app)/departments/actions";

interface DepartmentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  department: Department | null;
  allDepartments: readonly Department[];
  onSaved: () => void;
}

type FormValues = CreateDepartmentValues;

/** Single dialog for both create and edit — `department` being null/non-null decides the mode and which server action(s) submit calls. */
export function DepartmentFormDialog({
  open,
  onOpenChange,
  department,
  allDepartments,
  onSaved,
}: DepartmentFormDialogProps) {
  const isEdit = department !== null;
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(createDepartmentSchema),
    defaultValues: {
      name: "",
      code: "",
      description: null,
      color: null,
      hasIcLadder: true,
      hasManagerLadder: true,
      parentDepartmentId: null,
    },
  });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    reset({
      name: department?.name ?? "",
      code: department?.code ?? "",
      description: department?.description ?? null,
      color: department?.color ?? null,
      hasIcLadder: department?.hasIcLadder ?? true,
      hasManagerLadder: department?.hasManagerLadder ?? true,
      parentDepartmentId: department?.parentDepartmentId ?? null,
    });
  }, [open, department, reset]);

  const color = watch("color");
  const parentDepartmentId = watch("parentDepartmentId");
  const hasIcLadder = watch("hasIcLadder");
  const hasManagerLadder = watch("hasManagerLadder");

  // Collapse the two booleans into one friendly choice for the picker, and
  // expand a chosen option back to the booleans. "none" = no career ladders,
  // which excludes the department from the Level Mapping grid.
  const ladderChoice = hasIcLadder
    ? hasManagerLadder
      ? "both"
      : "ic"
    : hasManagerLadder
      ? "manager"
      : "none";
  const setLadderChoice = (choice: string) => {
    const ic = choice === "both" || choice === "ic";
    const manager = choice === "both" || choice === "manager";
    setValue("hasIcLadder", ic);
    setValue("hasManagerLadder", manager);
  };

  const eligibleParents = allDepartments.filter((candidate) => candidate.id !== department?.id);

  async function onSubmit(values: FormValues) {
    setFormError(null);
    startTransition(async () => {
      const result = isEdit
        ? await updateDepartmentAction({
            departmentId: department.id,
            name: values.name,
            code: values.code,
            description: values.description,
            color: values.color,
            hasIcLadder: values.hasIcLadder,
            hasManagerLadder: values.hasManagerLadder,
          })
        : await createDepartmentAction(values);

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

      if (isEdit && values.parentDepartmentId !== (department?.parentDepartmentId ?? null)) {
        const moveResult = await moveDepartmentAction({
          departmentId: department.id,
          newParentDepartmentId: values.parentDepartmentId ?? null,
        });
        if (!moveResult.ok) {
          setFormError(moveResult.error);
          return;
        }
      }

      onOpenChange(false);
      onSaved();
    });
  }

  const busy = isSubmitting || pending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={isEdit ? `Edit ${department.name}` : "Add Department"}
        description={isEdit ? "Update this department's details." : "Create a new department."}
      >
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          {formError ? (
            <p role="alert" className="text-destructive text-sm font-medium">
              {formError}
            </p>
          ) : null}

          <Field label="Name" required error={errors.name?.message}>
            {(fieldProps) => <Input {...fieldProps} {...register("name")} autoFocus />}
          </Field>

          <Field
            label="Code"
            required
            error={errors.code?.message}
            hint="Trimmed and uppercased automatically."
          >
            {(fieldProps) => <Input {...fieldProps} {...register("code")} />}
          </Field>

          <Field label="Description" error={errors.description?.message}>
            {(fieldProps) => <Textarea {...fieldProps} {...register("description")} rows={3} />}
          </Field>

          <Field label="Color" error={errors.color?.message} hint="Used for chart grouping.">
            {(fieldProps) => (
              <ColorSwatchPicker
                {...fieldProps}
                value={color}
                onChange={(next) => setValue("color", next, { shouldValidate: true })}
              />
            )}
          </Field>

          <Field
            label="Career ladders"
            hint="Controls which columns show in Level Mapping. Choose None for departments with no career ladders (e.g. Founder)."
          >
            {(fieldProps) => (
              <Select
                {...fieldProps}
                value={ladderChoice}
                onChange={(event) => setLadderChoice(event.target.value)}
              >
                <option value="both">Individual Contributor &amp; Manager</option>
                <option value="ic">Individual Contributor only</option>
                <option value="manager">Manager only</option>
                <option value="none">None (no career ladders)</option>
              </Select>
            )}
          </Field>

          <Field
            label="Parent department"
            error={undefined}
            hint="Optional — leave unset for a top-level department."
          >
            {(fieldProps) => (
              <Select
                {...fieldProps}
                value={parentDepartmentId ?? ""}
                onChange={(event) =>
                  setValue("parentDepartmentId", event.target.value || null, {
                    shouldValidate: true,
                  })
                }
              >
                <option value="">No parent (top-level)</option>
                {eligibleParents.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </Select>
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
              {busy ? "Saving…" : isEdit ? "Save changes" : "Create department"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
