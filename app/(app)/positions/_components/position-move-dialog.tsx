"use client";

import { useEffect, useMemo, useState } from "react";
import type { Position } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { getSubtreeSizeAction, movePositionAction } from "@/app/(app)/positions/actions";

interface PositionMoveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position: Position | null;
  allPositions: readonly Position[];
  onMoved: () => void;
}

/**
 * Dedicated "Change Reports-To" flow, separate from the plain-field edit
 * form — surfaces cycle prevention and descendant-recalculation feedback
 * clearly (docs/IMPLEMENTATION_PLAN.md Phase 5), rather than bundling a
 * hierarchy-affecting change into a generic form where its consequences
 * are easy to miss.
 */
export function PositionMoveDialog({
  open,
  onOpenChange,
  position,
  allPositions,
  onMoved,
}: PositionMoveDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [subtreeSize, setSubtreeSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open || !position) return;
    // Resetting local dialog state to match the position that was just
    // opened (and fetching its subtree size) is exactly what this effect
    // synchronizes — same pattern as department-form-dialog.tsx's `reset`
    // call, just via plain useState instead of react-hook-form's reset.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedId(position.primaryReportsToPositionId);
    setQuery("");
    setError(null);
    getSubtreeSizeAction(position.id).then((result) => {
      if (result.ok) setSubtreeSize(result.data);
    });
  }, [open, position]);

  const options: ComboboxOption[] = useMemo(() => {
    if (!position) return [];
    const candidates = allPositions.filter(
      (candidate) =>
        candidate.id !== position.id &&
        (query.trim() === "" ||
          candidate.title.toLowerCase().includes(query.toLowerCase()) ||
          candidate.positionCode.toLowerCase().includes(query.toLowerCase()))
    );
    const rootOption: ComboboxOption = {
      value: "__root__",
      label: "No manager (make this the root position)",
    };
    return [
      rootOption,
      ...candidates.map((candidate) => ({
        value: candidate.id,
        label: candidate.title,
        description: `${candidate.positionCode} · Level ${candidate.organizationalLevel}`,
      })),
    ];
  }, [allPositions, position, query]);

  const selectedOption = options.find((option) => option.value === (selectedId ?? "__root__"));

  async function handleConfirm() {
    if (!position) return;
    setError(null);
    setPending(true);
    const newParentPositionId = selectedId === "__root__" ? null : selectedId;
    const result = await movePositionAction({ positionId: position.id, newParentPositionId });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onOpenChange(false);
    onMoved();
  }

  if (!position) return null;

  const unchanged =
    (selectedId ?? "__root__") === (position.primaryReportsToPositionId ?? "__root__");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Change Reports-To for ${position.title}`}
        description="This changes the reporting hierarchy — the position's own level and every descendant's level are recalculated automatically. Department assignment and existing employee assignments are not affected."
      >
        <Field label="New Reports-To" error={undefined}>
          {(fieldProps) => (
            <Combobox
              {...fieldProps}
              value={selectedId ?? "__root__"}
              onChange={(value) => setSelectedId(value === "__root__" ? null : value)}
              options={options}
              query={query}
              onQueryChange={setQuery}
              placeholder="Search positions…"
              aria-label="New Reports-To position"
            />
          )}
        </Field>

        {subtreeSize !== null && subtreeSize > 0 ? (
          <p className="text-muted-foreground text-sm" role="status">
            {subtreeSize} descendant position{subtreeSize === 1 ? "" : "s"} will have{" "}
            {subtreeSize === 1 ? "its" : "their"} organizational level recalculated.
          </p>
        ) : null}

        {selectedOption ? (
          <p className="text-muted-foreground text-sm">
            Selected: <span className="text-foreground font-medium">{selectedOption.label}</span>
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
          <Button type="button" onClick={handleConfirm} disabled={pending || unchanged}>
            {pending ? "Moving…" : "Confirm move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
