"use client";

import { useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import type { CareerTrack, JobGrade } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createLevelMappingEntryAction } from "@/app/(app)/career-framework/actions";

interface LevelMappingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobFamilyId: string;
  /** The family's tracks — the only ones this dialog may map. */
  tracks: readonly CareerTrack[];
  /** Company levels (job grades), lowest to highest. */
  jobGrades: readonly JobGrade[];
  onSaved: () => void;
}

interface FormValues {
  careerTrackId: string;
  jobGradeId: string;
  title: string;
}

export function LevelMappingDialog({
  open,
  onOpenChange,
  jobFamilyId,
  tracks,
  jobGrades,
  onSaved,
}: LevelMappingDialogProps) {
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
    defaultValues: { careerTrackId: "", jobGradeId: "", title: "" },
  });

  useEffect(() => {
    if (open) {
      setFormError(null);
      reset({
        careerTrackId: tracks[0]?.id ?? "",
        jobGradeId: jobGrades[0]?.id ?? "",
        title: "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const careerTrackId = watch("careerTrackId");
  const jobGradeId = watch("jobGradeId");

  // Single-ladder families run one ladder, so there is no ladder to pick:
  // hide the picker and let the server use the family's default ladder.
  // Only a family with a parallel Manager ladder shows the choice.
  const hasManagerLadder = tracks.some((t) => t.kind === "MANAGER");

  function onSubmit(values: FormValues) {
    setFormError(null);
    startTransition(async () => {
      const result = await createLevelMappingEntryAction({
        jobFamilyId,
        // Omit the ladder in single mode; the server materialises/uses the
        // family's default (IC) ladder.
        ...(hasManagerLadder ? { careerTrackId: values.careerTrackId } : {}),
        jobGradeId: values.jobGradeId,
        title: values.title,
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
        title="Add title"
        description="Name the position title valid at this level. This configures career progression only — it does not set any reporting relationship."
      >
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          {formError ? (
            <p role="alert" className="text-destructive text-sm font-medium">
              {formError}
            </p>
          ) : null}

          {hasManagerLadder ? (
            <Field label="Ladder" required error={errors.careerTrackId?.message}>
              {(fieldProps) => (
                <Select
                  {...fieldProps}
                  value={careerTrackId}
                  onChange={(event) => setValue("careerTrackId", event.target.value)}
                >
                  {tracks.map((track) => (
                    <option key={track.id} value={track.id}>
                      {track.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}

          <Field label="Level" required error={errors.jobGradeId?.message}>
            {(fieldProps) => (
              <Select
                {...fieldProps}
                value={jobGradeId}
                onChange={(event) => setValue("jobGradeId", event.target.value)}
              >
                {jobGrades.map((grade) => (
                  <option key={grade.id} value={grade.id}>
                    {grade.code}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Position title" required error={errors.title?.message}>
            {(fieldProps) => (
              <Input
                {...fieldProps}
                {...register("title", { required: "Title is required." })}
                placeholder="e.g. Principal Software Engineer"
                autoFocus
              />
            )}
          </Field>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || jobGrades.length === 0}>
              Add title
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
