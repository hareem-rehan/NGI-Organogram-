"use client";

import { useEffect, useState } from "react";
import type { Employee } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { endAssignmentAction } from "@/app/(app)/employees/actions";
import type { CurrentAssignmentInfo } from "@/lib/repositories/employee.repository";

interface EndAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: Employee;
  currentAssignment: CurrentAssignmentInfo;
  onEnded: () => void;
}

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Ends the current assignment only — does not change employment status
 * (docs/phase-reports/PHASE_06_EMPLOYEES_AND_ASSIGNMENTS.md Step 16A).
 * Use "Terminate Employee" for ending employment entirely.
 */
export function EndAssignmentDialog({
  open,
  onOpenChange,
  employee,
  currentAssignment,
  onEnded,
}: EndAssignmentDialogProps) {
  const [endDate, setEndDate] = useState(todayInputValue());
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEndDate(todayInputValue());
    setError(null);
  }, [open]);

  async function handleConfirm() {
    if (!endDate) return;
    setError(null);
    setPending(true);
    const result = await endAssignmentAction({
      assignmentId: currentAssignment.assignmentId,
      endDate: new Date(endDate),
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onOpenChange(false);
    onEnded();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`End assignment for ${employee.firstName} ${employee.lastName}`}
        description={`${employee.firstName} will become unassigned, and ${currentAssignment.position.title} will become vacant from the end date forward. The employee's own record and status are not affected — this only ends the current position assignment.`}
      >
        <Field label="Effective end date" required>
          {(fieldProps) => (
            <Input
              {...fieldProps}
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          )}
        </Field>

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
          <Button type="button" variant="destructive" onClick={handleConfirm} disabled={pending}>
            {pending ? "Ending…" : "End assignment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
