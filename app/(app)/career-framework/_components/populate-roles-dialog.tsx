"use client";

import { useEffect, useState, useTransition } from "react";
import type { JobFamily } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { populateStandardRolesAction } from "@/app/(app)/career-framework/actions";
import { PMF_TRACKS, type PmfTrackKey } from "@/lib/domain/pmf-role-catalog";

interface PopulateRolesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  family: JobFamily | null;
  onSaved: () => void;
}

/**
 * Fills a family's matrix from the standard PMF role catalogue. The user
 * picks which track's titles apply to this family (Engineering, Project,
 * Product, HR, IT), then one click creates every level's title — instead of
 * typing them cell by cell. Existing titles are left untouched.
 */
export function PopulateRolesDialog({
  open,
  onOpenChange,
  family,
  onSaved,
}: PopulateRolesDialogProps) {
  const [track, setTrack] = useState<PmfTrackKey>("ENGINEERING");
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; alreadyPresent: number } | null>(null);
  const [pending, startTransition] = useTransition();

  // One-shot reinitialization gated on the open transition — the same
  // documented pattern the other career-framework dialogs use.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (open) {
      setTrack("ENGINEERING");
      setFormError(null);
      setResult(null);
    }
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function handlePopulate() {
    if (!family) return;
    setFormError(null);
    startTransition(async () => {
      const res = await populateStandardRolesAction({ jobFamilyId: family.id, track });
      if (!res.ok) {
        setFormError(res.error);
        return;
      }
      setResult(res.data);
      onSaved();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Populate standard roles"
        description={
          family
            ? `Fill "${family.name}" with the standard role titles for a track. You can rename or remove any of them afterwards.`
            : "Fill this family with standard role titles."
        }
      >
        {formError ? (
          <p role="alert" className="text-destructive text-sm font-medium">
            {formError}
          </p>
        ) : null}

        {result ? (
          <div className="flex flex-col gap-3">
            <p className="text-foreground text-sm">
              {result.created > 0
                ? `Added ${result.created} role title${result.created === 1 ? "" : "s"}.`
                : "No new titles were added."}
              {result.alreadyPresent > 0
                ? ` ${result.alreadyPresent} were already present and left unchanged.`
                : ""}
            </p>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Field label="Role track" required>
              {(fieldProps) => (
                <Select
                  {...fieldProps}
                  value={track}
                  onChange={(event) => setTrack(event.target.value as PmfTrackKey)}
                >
                  {PMF_TRACKS.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                      {t.ic && t.manager ? " (IC + Manager)" : " (Manager)"}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <p className="text-muted-foreground text-xs">
              Tracks with both ladders (Engineering, Product) fill the base ladder and add a
              parallel Manager ladder. Manager-only tracks (Project, HR, IT) fill this family&apos;s
              single ladder.
            </p>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={handlePopulate} disabled={pending}>
                Populate roles
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
