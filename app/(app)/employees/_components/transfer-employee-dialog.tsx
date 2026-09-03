"use client";

import { useEffect, useMemo, useState } from "react";
import type { Employee } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { listEligiblePositionsAction, transferEmployeeAction } from "@/app/(app)/employees/actions";
import type { CurrentAssignmentInfo } from "@/lib/repositories/employee.repository";
import type { EligiblePosition } from "@/lib/repositories/position.repository";

interface TransferEmployeeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: Employee;
  currentAssignment: CurrentAssignmentInfo;
  currentDepartmentName: string | null;
  onTransferred: () => void;
}

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Dedicated transfer flow — never combined with position/hierarchy
 * editing. Shows a clear before/after summary and explains the
 * consequences (old assignment ends and is preserved, new one begins,
 * neither position is deleted, reporting hierarchy is untouched) before
 * requiring confirmation (docs/phase-reports/PHASE_06_EMPLOYEES_AND_ASSIGNMENTS.md
 * Step 15).
 */
export function TransferEmployeeDialog({
  open,
  onOpenChange,
  employee,
  currentAssignment,
  currentDepartmentName,
  onTransferred,
}: TransferEmployeeDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [transferDate, setTransferDate] = useState(todayInputValue());
  const [options, setOptions] = useState<EligiblePosition[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedId(null);
    setQuery("");
    setTransferDate(todayInputValue());
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingOptions(true);
    void (async () => {
      const result = await listEligiblePositionsAction({
        search: query || undefined,
        effectiveDate: transferDate ? new Date(transferDate) : undefined,
      });
      setLoadingOptions(false);
      if (result.ok) {
        setOptions(result.data.filter((o) => o.position.id !== currentAssignment.position.id));
      }
    })();
  }, [open, query, transferDate, currentAssignment.position.id]);

  const comboboxOptions: ComboboxOption[] = useMemo(
    () =>
      options.map((eligible) => ({
        value: eligible.position.id,
        label: eligible.position.title,
        description: `${eligible.position.positionCode} · ${eligible.departmentName} · Level ${eligible.position.organizationalLevel}`,
      })),
    [options]
  );

  const destination = options.find((o) => o.position.id === selectedId) ?? null;

  async function handleConfirm() {
    if (!selectedId || !transferDate) return;
    setError(null);
    setPending(true);
    const result = await transferEmployeeAction({
      employeeId: employee.id,
      fromAssignmentId: currentAssignment.assignmentId,
      toPositionId: selectedId,
      transferDate: new Date(transferDate),
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onOpenChange(false);
    onTransferred();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Transfer ${employee.firstName} ${employee.lastName}`}
        description="The current assignment will end and a new one will begin on the transfer date. Assignment history is preserved; neither position is deleted; the reporting hierarchy is not changed."
      >
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Current
            </p>
            <p className="font-medium">{currentAssignment.position.title}</p>
            <p className="text-muted-foreground">{currentDepartmentName ?? "—"}</p>
            <p className="text-muted-foreground">
              Since {currentAssignment.startDate.toISOString().slice(0, 10)}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Destination
            </p>
            {destination ? (
              <>
                <p className="font-medium">{destination.position.title}</p>
                <p className="text-muted-foreground">{destination.departmentName}</p>
                <p className="text-muted-foreground">
                  Level {destination.position.organizationalLevel}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">Select a position below</p>
            )}
          </div>
        </div>

        <Field label="Transfer effective date" required>
          {(fieldProps) => (
            <Input
              {...fieldProps}
              type="date"
              value={transferDate}
              onChange={(event) => setTransferDate(event.target.value)}
            />
          )}
        </Field>

        <Field label="Destination position" required>
          {(fieldProps) => (
            <Combobox
              {...fieldProps}
              value={selectedId}
              onChange={setSelectedId}
              options={comboboxOptions}
              query={query}
              onQueryChange={setQuery}
              loading={loadingOptions}
              emptyMessage="No eligible destination positions found for this date."
              placeholder="Search positions…"
              aria-label="Destination position"
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
          <Button type="button" onClick={handleConfirm} disabled={pending || !selectedId}>
            {pending ? "Transferring…" : "Confirm transfer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
