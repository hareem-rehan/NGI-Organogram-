"use client";

import { useState, useTransition } from "react";
import type { CareerTrackKind } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  createDepartmentLevelTitleAction,
  updateDepartmentLevelTitleAction,
} from "@/app/(app)/levels-mapping/actions";

const LADDER_LABEL: Record<CareerTrackKind, string> = {
  IC: "Individual Contributor",
  MANAGER: "Manager",
};

/**
 * The cell a dialog is targeting. In "create" mode the department, level and
 * ladder are fixed by the clicked cell and shown as read-only context — only
 * the title is entered. In "edit" mode the title is pre-filled from `id`.
 */
export interface LevelTitleTarget {
  mode: "create" | "edit";
  departmentId: string;
  departmentName: string;
  kind: CareerTrackKind;
  jobGradeCode: string;
  scaleName: string;
  id?: string;
  title?: string;
}

interface LevelTitleDialogProps {
  target: LevelTitleTarget | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

/**
 * The parent remounts this per target (via `key`), so state initialises fresh
 * from props on each open — no setState-in-effect syncing needed.
 */
export function LevelTitleDialog({ target, onOpenChange, onSaved }: LevelTitleDialogProps) {
  const open = target !== null;
  const [title, setTitle] = useState(target?.title ?? "");
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!target) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setFormError("Level name is required.");
      return;
    }
    setFormError(null);
    startTransition(async () => {
      const result =
        target.mode === "edit" && target.id
          ? await updateDepartmentLevelTitleAction({ id: target.id, title: trimmed })
          : await createDepartmentLevelTitleAction({
              departmentId: target.departmentId,
              jobGradeCode: target.jobGradeCode,
              kind: target.kind,
              title: trimmed,
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
        title={target?.mode === "edit" ? "Edit level name" : "Add level name"}
        description={
          target
            ? `${target.departmentName} · ${LADDER_LABEL[target.kind]} · ${target.jobGradeCode} — ${target.scaleName}`
            : ""
        }
      >
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {formError ? (
            <p role="alert" className="text-destructive text-sm font-medium">
              {formError}
            </p>
          ) : null}

          <Field label="Level name" required error={formError ?? undefined}>
            {(fieldProps) => (
              <Input
                {...fieldProps}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Software Engineer"
                autoFocus
              />
            )}
          </Field>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : target?.mode === "edit" ? "Save changes" : "Add level name"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
