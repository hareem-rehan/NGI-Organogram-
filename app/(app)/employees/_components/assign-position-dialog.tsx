"use client";

import { useEffect, useMemo, useState } from "react";
import type { Employee } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { assignEmployeeAction, listEligiblePositionsAction } from "@/app/(app)/employees/actions";
import type { EligiblePosition } from "@/lib/repositories/position.repository";

interface AssignPositionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: Employee;
  onAssigned: () => void;
}

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * "Assign to Position" flow for a currently-unassigned, eligible
 * employee. The position picker is server-side eligibility-checked
 * (lib/repositories/position.repository.ts's `searchEligiblePositions`),
 * re-queried whenever the effective date changes, so it can never
 * suggest a position the actual assignment call would then reject —
 * but the server still re-validates on submit regardless (a concurrent
 * assignment could have landed in between).
 */
export function AssignPositionDialog({
  open,
  onOpenChange,
  employee,
  onAssigned,
}: AssignPositionDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(todayInputValue());
  const [options, setOptions] = useState<EligiblePosition[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedId(null);
    setQuery("");
    setEffectiveDate(todayInputValue());
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingOptions(true);
    void (async () => {
      const result = await listEligiblePositionsAction({
        search: query || undefined,
        effectiveDate: effectiveDate ? new Date(effectiveDate) : undefined,
      });
      setLoadingOptions(false);
      if (result.ok) setOptions(result.data);
    })();
  }, [open, query, effectiveDate]);

  const comboboxOptions: ComboboxOption[] = useMemo(
    () =>
      options.map((eligible) => ({
        value: eligible.position.id,
        label: eligible.position.title,
        description: `${eligible.position.positionCode} · ${eligible.departmentName} · Level ${eligible.position.organizationalLevel}`,
      })),
    [options]
  );

  const selected = options.find((o) => o.position.id === selectedId) ?? null;

  async function handleConfirm() {
    if (!selectedId || !effectiveDate) return;
    setError(null);
    setPending(true);
    const result = await assignEmployeeAction({
      employeeId: employee.id,
      positionId: selectedId,
      startDate: new Date(effectiveDate),
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onOpenChange(false);
    onAssigned();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Assign ${employee.firstName} ${employee.lastName} to a Position`}
        description="Only positions that are vacant on the effective date, in an active department, and not archived are shown."
      >
        <Field label="Effective start date" required>
          {(fieldProps) => (
            <Input
              {...fieldProps}
              type="date"
              value={effectiveDate}
              onChange={(event) => setEffectiveDate(event.target.value)}
            />
          )}
        </Field>

        <Field label="Position" required>
          {(fieldProps) => (
            <Combobox
              {...fieldProps}
              value={selectedId}
              onChange={setSelectedId}
              options={comboboxOptions}
              query={query}
              onQueryChange={setQuery}
              loading={loadingOptions}
              emptyMessage="No eligible positions found for this date."
              placeholder="Search positions…"
              aria-label="Position"
            />
          )}
        </Field>

        {selected ? (
          <div className="bg-muted rounded-md p-3 text-sm">
            <p className="font-medium">{selected.position.title}</p>
            <p className="text-muted-foreground">
              {selected.position.positionCode} · {selected.departmentName} · Level{" "}
              {selected.position.organizationalLevel} ·{" "}
              {selected.position.status === "ACTIVE"
                ? "Active"
                : selected.position.status === "PLANNED"
                  ? "Planned"
                  : "Inactive"}
            </p>
          </div>
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
          <Button type="button" onClick={handleConfirm} disabled={pending || !selectedId}>
            {pending ? "Assigning…" : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
