"use client";

import { useEffect, useState } from "react";
import type { Employee } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { changeAssignmentStartDateAction } from "@/app/(app)/employees/actions";
import type { CurrentAssignmentInfo } from "@/lib/repositories/employee.repository";

interface EditAssignmentStartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: Employee;
  currentAssignment: CurrentAssignmentInfo;
  onSaved: () => void;
}

function toInputValue(date: Date): string {
  return new Date(date).toISOString().slice(0, 10);
}

/**
 * Corrects the current assignment's start date (D69). Only the date
 * changes — the position and reporting line stay as they are.
 */
export function EditAssignmentStartDialog({
  open,
  onOpenChange,
  employee,
  currentAssignment,
  onSaved,
}: EditAssignmentStartDialogProps) {
  const [startDate, setStartDate] = useState(toInputValue(currentAssignment.startDate));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStartDate(toInputValue(currentAssignment.startDate));
    setError(null);
  }, [open, currentAssignment.startDate]);

  const unchanged = startDate === toInputValue(currentAssignment.startDate);
  const inFuture = startDate > toInputValue(new Date());

  async function handleSave() {
    if (!startDate || unchanged) return;
    setError(null);
    setPending(true);
    const result = await changeAssignmentStartDateAction({
      assignmentId: currentAssignment.assignmentId,
      startDate: new Date(startDate),
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Edit assignment start date for ${employee.firstName} ${employee.lastName}`}
        description={`Changes when ${employee.firstName}'s assignment to ${currentAssignment.position.title} started. The position and reporting line stay the same.`}
      >
        <Field label="Assignment start date" required>
          {(fieldProps) => (
            <Input
              {...fieldProps}
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          )}
        </Field>

        {inFuture ? (
          <p className="text-muted-foreground text-sm">
            This date is in the future: {employee.firstName} will show as unassigned, and the
            position as vacant, until then.
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="text-destructive text-sm font-medium">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={pending || !startDate || unchanged}>
            {pending ? "Saving…" : "Save start date"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
