"use client";

import { useEffect, useMemo, useState } from "react";
import type { Position } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { bulkMovePositionsAction } from "@/app/(app)/positions/actions";
import { reportsToDescription } from "@/app/(app)/positions/_components/position-form-dialog";

interface PositionsBulkMoveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The positions selected for the bulk move. */
  selected: readonly Position[];
  allPositions: readonly Position[];
  jobFamilyNameById?: ReadonlyMap<string, string>;
  onDone: () => void;
}

/**
 * Bulk "Change Reports-To": re-parents every selected position under one new
 * manager. Cycle prevention and level recalculation are enforced per position
 * by the server (`bulkMovePositionsAction` → `movePosition`), so a move that
 * would create a cycle is refused for that position while the rest still
 * apply; the per-position outcome is surfaced here.
 */
export function PositionsBulkMoveDialog({
  open,
  onOpenChange,
  selected,
  allPositions,
  jobFamilyNameById,
  onDone,
}: PositionsBulkMoveDialogProps) {
  // Raw Combobox value: "" = nothing chosen yet, "__root__" = make root,
  // otherwise a position id. Kept as the raw string so "make root" is
  // distinguishable from "not chosen" (both would collapse to null otherwise).
  const [parentValue, setParentValue] = useState<string>("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [failures, setFailures] = useState<{ id: string; error: string }[] | null>(null);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setParentValue("");
    setQuery("");
    setError(null);
    setFailures(null);
  }, [open]);

  const selectedIdSet = useMemo(() => new Set(selected.map((p) => p.id)), [selected]);
  const titleById = useMemo(
    () => new Map(allPositions.map((p) => [p.id, p.title])),
    [allPositions]
  );

  const options: ComboboxOption[] = useMemo(() => {
    // A selected position can never become the new manager of the group (it
    // would be reporting to itself); everything else is a candidate. Genuine
    // cycles among the rest are still caught server-side per position.
    const candidates = allPositions.filter(
      (candidate) =>
        !selectedIdSet.has(candidate.id) &&
        (query.trim() === "" ||
          candidate.title.toLowerCase().includes(query.toLowerCase()) ||
          candidate.positionCode.toLowerCase().includes(query.toLowerCase()))
    );
    return [
      { value: "__root__", label: "No manager (make root position)" },
      ...candidates.map((candidate) => ({
        value: candidate.id,
        label: candidate.title,
        description: reportsToDescription(candidate, jobFamilyNameById),
      })),
    ];
  }, [allPositions, selectedIdSet, query, jobFamilyNameById]);

  async function handleConfirm() {
    setError(null);
    setFailures(null);
    setPending(true);
    const newParentPositionId = parentValue === "__root__" ? null : parentValue;
    const result = await bulkMovePositionsAction({
      positionIds: selected.map((p) => p.id),
      newParentPositionId,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.data.failed.length === 0) {
      onOpenChange(false);
      onDone();
      return;
    }
    // Some moves were refused (e.g. a cycle) — keep the dialog open and show
    // exactly which and why, then let the list refresh for the ones that did.
    setFailures(result.data.failed);
    onDone();
  }

  if (selected.length === 0) return null;
  const hasChoice = parentValue !== "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Change Reports-To for ${selected.length} position${selected.length === 1 ? "" : "s"}`}
        description="Every selected position is moved under the manager you choose. Each position's own level and its descendants' levels are recalculated automatically. Department and employee assignments are unaffected."
      >
        {failures ? (
          <div className="space-y-2 text-sm" role="status">
            <p className="text-foreground font-medium">
              {selected.length - failures.length} moved, {failures.length} could not be moved:
            </p>
            <ul className="text-destructive list-inside list-disc">
              {failures.map((f) => (
                <li key={f.id}>
                  <span className="font-medium">{titleById.get(f.id) ?? f.id}</span>: {f.error}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <Field label="New Reports-To" error={undefined}>
            {(fieldProps) => (
              <Combobox
                {...fieldProps}
                value={parentValue}
                onChange={(value) => setParentValue(value)}
                options={options}
                query={query}
                onQueryChange={setQuery}
                placeholder="Search positions…"
                aria-label="New Reports-To position"
              />
            )}
          </Field>
        )}

        {error ? (
          <p role="alert" className="text-destructive text-sm font-medium">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          {failures ? (
            <Button type="button" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="button" onClick={handleConfirm} disabled={pending || !hasChoice}>
                {pending ? "Moving…" : `Move ${selected.length}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
