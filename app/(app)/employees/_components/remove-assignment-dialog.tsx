"use client";

import { useEffect, useState } from "react";
import type { Employee } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { removeAssignmentAction } from "@/app/(app)/employees/actions";
import type { AssignmentHistoryRow } from "@/lib/repositories/assignment.repository";

interface RemoveAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: Employee;
  /** The history row to remove; never the current assignment. */
  assignment: AssignmentHistoryRow;
  onRemoved: () => void;
}

function formatDate(date: Date): string {
  return new Date(date).toISOString().slice(0, 10);
}

/**
 * Removes an assignment-history row entered by mistake (D70). Only that row
 * goes; the position and the employee record stay as they are.
 */
export function RemoveAssignmentDialog({
  open,
  onOpenChange,
  employee,
  assignment,
  onRemoved,
}: RemoveAssignmentDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setError(null);
  }, [open]);

  async function handleRemove() {
    setError(null);
    setPending(true);
    const result = await removeAssignmentAction({ assignmentId: assignment.id });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onOpenChange(false);
    onRemoved();
  }

  const range = `${formatDate(assignment.startDate)} to ${
    assignment.endDate ? formatDate(assignment.endDate) : "—"
  }`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Remove this assignment from the history?"
        description={`${employee.firstName} ${employee.lastName}'s assignment to ${assignment.position.title} (${range}) will be removed, as if it had never been entered. Use this only for a row entered by mistake. The position and the employee record are not changed, and the removal is recorded in the Audit Log.`}
      >
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
          <Button type="button" variant="destructive" onClick={handleRemove} disabled={pending}>
            {pending ? "Removing…" : "Remove from history"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
