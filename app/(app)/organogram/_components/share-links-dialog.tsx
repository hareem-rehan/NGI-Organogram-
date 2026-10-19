"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Check, Copy, Link2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  createShareLinkAction,
  listShareLinksAction,
  revokeShareLinkAction,
} from "@/app/(app)/organogram/share-actions";
import type { ShareLinkSummary } from "@/lib/services/share-link.service";

interface ShareLinksDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ExpiryChoice = "7" | "30" | "never";

const STATUS_BADGE: Record<
  ShareLinkSummary["status"],
  { label: string; variant: "success" | "muted" }
> = {
  active: { label: "Active", variant: "success" },
  expired: { label: "Expired", variant: "muted" },
  off: { label: "Turned off", variant: "muted" },
};

function shareUrl(token: string): string {
  return `${window.location.origin}/share/${token}`;
}

function formatDate(value: Date | string): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Create, copy and turn off view-only organogram links (docs/DECISIONS.md
 * D60). Anyone with an active link can view the chart without signing in;
 * the dialog says so before a link is made.
 */
export function ShareLinksDialog({ open, onOpenChange }: ShareLinksDialogProps) {
  const [links, setLinks] = useState<ShareLinkSummary[]>([]);
  const [label, setLabel] = useState("");
  const [expiry, setExpiry] = useState<ExpiryChoice>("30");
  const [error, setError] = useState<string | null>(null);
  const [newLinkId, setNewLinkId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmOffId, setConfirmOffId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    const result = await listShareLinksAction();
    if (result.ok) setLinks(result.data);
    else setError(result.error);
  }, []);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setError(null);
    setNewLinkId(null);
    setConfirmOffId(null);
    setLabel("");
    setExpiry("30");
    /* eslint-enable react-hooks/set-state-in-effect */
    void load();
  }, [open, load]);

  function create() {
    setError(null);
    startTransition(async () => {
      const result = await createShareLinkAction({
        label: label.trim() || null,
        expiresInDays: expiry === "never" ? null : Number(expiry),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNewLinkId(result.data.id);
      setLabel("");
      await load();
    });
  }

  async function copy(link: ShareLinkSummary) {
    try {
      await navigator.clipboard.writeText(shareUrl(link.token));
      setCopiedId(link.id);
      setTimeout(() => setCopiedId((current) => (current === link.id ? null : current)), 2000);
    } catch {
      setError("Couldn't copy automatically — select the link and copy it.");
    }
  }

  function turnOff(link: ShareLinkSummary) {
    setError(null);
    startTransition(async () => {
      const result = await revokeShareLinkAction({ shareLinkId: link.id });
      if (!result.ok) setError(result.error);
      setConfirmOffId(null);
      await load();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Share a view-only link"
        description="Anyone with the link can view this organogram without signing in — expand and collapse it, search, see card details and download a PDF or PNG. They can't change anything or open employee records."
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Field label="Label (optional)" hint="Only you and your team see this.">
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    value={label}
                    maxLength={80}
                    placeholder="e.g. Board pack"
                    onChange={(event) => setLabel(event.target.value)}
                  />
                )}
              </Field>
              <Field label="Link works for">
                {(fieldProps) => (
                  <Select
                    {...fieldProps}
                    value={expiry}
                    onChange={(event) => setExpiry(event.target.value as ExpiryChoice)}
                  >
                    <option value="7">7 days</option>
                    <option value="30">30 days</option>
                    <option value="never">Until turned off</option>
                  </Select>
                )}
              </Field>
            </div>
            <Button type="button" onClick={create} disabled={pending} className="self-start">
              <Link2 aria-hidden="true" className="size-4" />
              Create link
            </Button>
          </div>

          {error ? (
            <p role="alert" className="text-destructive text-sm font-medium">
              {error}
            </p>
          ) : null}

          <section aria-label="Share links" className="flex flex-col gap-2">
            <h3 className="text-foreground text-sm font-semibold">Links</h3>
            {links.length === 0 ? (
              <p className="text-muted-foreground text-sm">No links yet.</p>
            ) : (
              <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
                {links.map((link) => {
                  const badge = STATUS_BADGE[link.status];
                  const active = link.status === "active";
                  return (
                    <li
                      key={link.id}
                      className={
                        link.id === newLinkId
                          ? "border-primary/40 bg-primary/5 rounded-md border p-3"
                          : "border-border rounded-md border p-3"
                      }
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-foreground text-sm font-medium">
                          {link.label ?? "View-only link"}
                        </span>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </div>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        Created {formatDate(link.createdAt)} ·{" "}
                        {link.revokedAt
                          ? `turned off ${formatDate(link.revokedAt)}`
                          : link.expiresAt
                            ? `${active ? "works until" : "expired"} ${formatDate(link.expiresAt)}`
                            : "works until turned off"}
                      </p>
                      {active ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Input
                            readOnly
                            aria-label={`Link for ${link.label ?? "view-only link"}`}
                            value={shareUrl(link.token)}
                            onFocus={(event) => event.currentTarget.select()}
                            className="h-8 min-w-0 flex-1 text-xs"
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => copy(link)}
                          >
                            {copiedId === link.id ? (
                              <Check aria-hidden="true" className="size-4" />
                            ) : (
                              <Copy aria-hidden="true" className="size-4" />
                            )}
                            {copiedId === link.id ? "Copied" : "Copy"}
                          </Button>
                          {confirmOffId === link.id ? (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                disabled={pending}
                                onClick={() => turnOff(link)}
                              >
                                Turn off for everyone
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => setConfirmOffId(null)}
                              >
                                Keep
                              </Button>
                            </>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => setConfirmOffId(link.id)}
                            >
                              Turn off
                            </Button>
                          )}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
