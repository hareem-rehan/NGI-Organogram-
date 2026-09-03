"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  pending?: boolean;
  errorMessage?: string | null;
  onConfirm: () => void;
}

/**
 * Shared confirmation dialog for irreversible-feeling actions (end
 * assignment, terminate employee, deactivate department/position) — a
 * consistent double-check pattern across the app rather than one-off
 * `window.confirm()` calls or silent single-click destructive buttons.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  destructive,
  pending,
  errorMessage,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description}>
        {children}
        {errorMessage ? (
          <p role="alert" className="text-destructive text-sm font-medium">
            {errorMessage}
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
            variant={destructive ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function useConfirmDialog() {
  const [open, setOpen] = useState(false);
  return { open, setOpen };
}
