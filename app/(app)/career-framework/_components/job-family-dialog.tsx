"use client";

import { useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import type { Department, JobFamily } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createJobFamilyAction, updateJobFamilyAction } from "@/app/(app)/career-framework/actions";

interface JobFamilyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create, otherwise edit. */
  jobFamily: JobFamily | null;
  departments: readonly Department[];
  onSaved: () => void;
}

interface FormValues {
  departmentId: string;
  name: string;
  code: string;
  description: string | null;
}

export function JobFamilyDialog({
  open,
  onOpenChange,
  jobFamily,
  departments,
  onSaved,
}: JobFamilyDialogProps) {
  const isEdit = jobFamily !== null;
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: { departmentId: "", name: "", code: "", description: null },
  });

  useEffect(() => {
    if (open) {
      setFormError(null);
      reset({
        departmentId: jobFamily?.departmentId ?? departments[0]?.id ?? "",
        name: jobFamily?.name ?? "",
        code: jobFamily?.code ?? "",
        description: jobFamily?.description ?? null,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const departmentId = watch("departmentId");

  function onSubmit(values: FormValues) {
    setFormError(null);
    startTransition(async () => {
      const result = isEdit
        ? await updateJobFamilyAction({
            jobFamilyId: jobFamily.id,
            name: values.name,
            code: values.code,
            description: values.description,
          })
        : await createJobFamilyAction({
            departmentId: values.departmentId,
            name: values.name,
            code: values.code,
            description: values.description,
          });

      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      onOpenChange(false);
      onSaved();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={isEdit ? `Edit ${jobFamily.name}` : "Add Sub-division"}
        description="A sub-division is a career specialization within a department (e.g. Software Engineering, QA). It is separate from the reporting hierarchy."
      >
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          {formError ? (
            <p role="alert" className="text-destructive text-sm font-medium">
              {formError}
            </p>
          ) : null}

          <Field label="Name" required error={errors.name?.message}>
            {(fieldProps) => (
              <Input
                {...fieldProps}
                {...register("name", { required: "Name is required." })}
                autoFocus
              />
            )}
          </Field>

          <Field label="Code" required error={errors.code?.message}>
            {(fieldProps) => (
              <Input {...fieldProps} {...register("code", { required: "Code is required." })} />
            )}
          </Field>

          {!isEdit ? (
            <Field label="Department" required error={errors.departmentId?.message}>
              {(fieldProps) => (
                <Select
                  {...fieldProps}
                  value={departmentId}
                  onChange={(event) => setValue("departmentId", event.target.value)}
                >
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}

          <Field label="Description" error={errors.description?.message}>
            {(fieldProps) => <Textarea {...fieldProps} {...register("description")} rows={2} />}
          </Field>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {isEdit ? "Save changes" : "Create sub-division"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
