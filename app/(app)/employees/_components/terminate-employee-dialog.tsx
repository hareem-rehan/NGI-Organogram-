"use client";

import { useEffect, useState } from "react";
import type { Employee } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { terminateEmployeeAction } from "@/app/(app)/employees/actions";

interface TerminateEmployeeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: Employee;
  hasActiveAssignment: boolean;
  onTerminated: () => void;
}

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The guided termination workflow — distinct from "End Assignment" and
 * never called "Delete Employee" (the employee record and its history
 * are always preserved, docs/phase-reports/PHASE_06_EMPLOYEES_AND_ASSIGNMENTS.md
 * Step 16B). Requires an explicit typed confirmation to reduce the risk
 * of an accidental click on a destructive-feeling action.
 */
export function TerminateEmployeeDialog({
  open,
  onOpenChange,
  employee,
  hasActiveAssignment,
  onTerminated,
}: TerminateEmployeeDialogProps) {
  const [terminationDate, setTerminationDate] = useState(todayInputValue());
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTerminationDate(todayInputValue());
    setConfirmText("");
    setError(null);
  }, [open]);

  const expectedConfirmation = employee.employeeCode;
  const canConfirm = confirmText.trim() === expectedConfirmation;

  async function handleConfirm() {
    if (!terminationDate || !canConfirm) return;
    setError(null);
    setPending(true);
    const result = await terminateEmployeeAction({
      employeeId: employee.id,
      terminationDate: new Date(terminationDate),
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onOpenChange(false);
    onTerminated();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Terminate ${employee.firstName} ${employee.lastName}`}
        description={
          hasActiveAssignment
            ? "The active position assignment will end on the termination date, and the position will remain — it will simply become vacant. The employee record and full assignment history are preserved, not deleted."
            : "This employee has no active assignment. The employee record and assignment history are preserved, not deleted."
        }
      >
        <Field label="Termination date" required>
          {(fieldProps) => (
            <Input
              {...fieldProps}
              type="date"
              value={terminationDate}
              onChange={(event) => setTerminationDate(event.target.value)}
            />
          )}
        </Field>

        <Field
          label={`Type the employee code (${expectedConfirmation}) to confirm`}
          required
          hint="This prevents an accidental termination from a single click."
        >
          {(fieldProps) => (
            <Input
              {...fieldProps}
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              autoComplete="off"
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
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={pending || !canConfirm}
          >
            {pending ? "Terminating…" : "Terminate employee"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
