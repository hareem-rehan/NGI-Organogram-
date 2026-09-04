"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import type { AuditAction, AuditCategory, AuditEvent } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingState } from "@/components/patterns/loading-state";
import { Pagination } from "@/components/patterns/pagination";
import { getAuditEventAction, listAuditEventsAction } from "@/app/(app)/audit-log/actions";
import { DEFAULT_AUDIT_PAGE_SIZE } from "@/lib/domain/audit/pagination";

const CATEGORIES: readonly AuditCategory[] = [
  "AUTHENTICATION",
  "USER_ADMINISTRATION",
  "COMPANY_SETTINGS",
  "DEPARTMENT",
  "POSITION",
  "HIERARCHY",
  "EMPLOYEE",
  "ASSIGNMENT",
  "IMPORT",
  "EXPORT",
  "SECURITY",
  "SYSTEM",
];

const ACTIONS: readonly AuditAction[] = [
  "CREATED",
  "UPDATED",
  "ARCHIVED",
  "REACTIVATED",
  "ASSIGNED",
  "TRANSFERRED",
  "ASSIGNMENT_ENDED",
  "TERMINATED",
  "ROLE_CHANGED",
  "USER_DISABLED",
  "USER_REACTIVATED",
  "USER_PROVISIONED",
  "USER_LINKED_TO_EMPLOYEE",
  "USER_UNLINKED_FROM_EMPLOYEE",
  "SETTINGS_CHANGED",
  "IMPORT_VALIDATED",
  "IMPORT_EXECUTED",
  "IMPORT_FAILED",
  "EXPORT_REQUESTED",
  "EXPORT_COMPLETED",
  "EXPORT_FAILED",
  "LOGIN_SUCCEEDED",
  "LOGIN_REJECTED",
  "UNAUTHORIZED_ACCESS_ATTEMPT",
];

function formatTimestamp(value: Date | string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function actorLabel(event: AuditEvent): string {
  if (event.actorType === "SYSTEM") return "System";
  return event.actorDisplayNameSnapshot || event.actorEmailSnapshot || "Unknown user";
}

function actionVariant(
  action: AuditAction
): "default" | "warning" | "destructive" | "success" | "muted" {
  if (
    action.includes("FAILED") ||
    action === "UNAUTHORIZED_ACCESS_ATTEMPT" ||
    action === "USER_DISABLED"
  ) {
    return "destructive";
  }
  if (action === "ARCHIVED" || action === "TERMINATED" || action === "ASSIGNMENT_ENDED")
    return "warning";
  if (action === "CREATED" || action === "REACTIVATED" || action === "USER_REACTIVATED")
    return "success";
  return "muted";
}

function readableJson(value: unknown): string {
  if (value === null || value === undefined) return "—";
  return JSON.stringify(value, null, 2);
}

export function AuditLogView() {
  const [category, setCategory] = useState<AuditCategory | "">("");
  const [action, setAction] = useState<AuditAction | "">("");
  const [entityType, setEntityType] = useState("");
  const [actorSearch, setActorSearch] = useState("");
  const [occurredFrom, setOccurredFrom] = useState("");
  const [occurredTo, setOccurredTo] = useState("");
  const [page, setPage] = useState(1);

  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    startTransition(async () => {
      const result = await listAuditEventsAction({
        category: category || undefined,
        action: action || undefined,
        entityType: entityType.trim() || undefined,
        actorEmailContains: actorSearch.trim() || undefined,
        occurredFrom: occurredFrom ? new Date(occurredFrom) : undefined,
        occurredTo: occurredTo ? new Date(occurredTo) : undefined,
        page,
        pageSize: DEFAULT_AUDIT_PAGE_SIZE,
      });
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEvents(result.data.events);
      setTotal(result.data.total);
    });
  }, [category, action, entityType, actorSearch, occurredFrom, occurredTo, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  async function openDetail(eventId: string) {
    setDetailLoading(true);
    setDetailError(null);
    setSelectedEvent(null);
    const result = await getAuditEventAction({ eventId });
    setDetailLoading(false);
    if (!result.ok) {
      setDetailError(result.error);
      return;
    }
    setSelectedEvent(result.data);
  }

  function resetFilters() {
    setCategory("");
    setAction("");
    setEntityType("");
    setActorSearch("");
    setOccurredFrom("");
    setOccurredTo("");
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="border-border grid grid-cols-1 gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Category">
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={category}
              onChange={(e) => {
                setCategory(e.target.value as AuditCategory | "");
                setPage(1);
              }}
            >
              <option value="">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Action">
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={action}
              onChange={(e) => {
                setAction(e.target.value as AuditAction | "");
                setPage(1);
              }}
            >
              <option value="">All actions</option>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Entity type" hint="e.g. Department, Position, User">
          {(fieldProps) => (
            <Input
              {...fieldProps}
              value={entityType}
              onChange={(e) => {
                setEntityType(e.target.value);
                setPage(1);
              }}
            />
          )}
        </Field>
        <Field label="Actor email contains">
          {(fieldProps) => (
            <Input
              {...fieldProps}
              value={actorSearch}
              onChange={(e) => {
                setActorSearch(e.target.value);
                setPage(1);
              }}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="From">
            {(fieldProps) => (
              <Input
                {...fieldProps}
                type="date"
                value={occurredFrom}
                onChange={(e) => {
                  setOccurredFrom(e.target.value);
                  setPage(1);
                }}
              />
            )}
          </Field>
          <Field label="To">
            {(fieldProps) => (
              <Input
                {...fieldProps}
                type="date"
                value={occurredTo}
                onChange={(e) => {
                  setOccurredTo(e.target.value);
                  setPage(1);
                }}
              />
            )}
          </Field>
        </div>
        <div className="col-span-full flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={resetFilters}>
            Reset filters
          </Button>
        </div>
      </div>

      {loading && events.length === 0 ? (
        <LoadingState label="Loading audit log…" />
      ) : error ? (
        <ErrorState description={error} onRetry={refresh} />
      ) : events.length === 0 ? (
        <EmptyState
          title="No matching audit events"
          description="Try widening the date range or removing a filter."
        />
      ) : (
        <div className="border-border overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-muted-foreground text-left text-xs uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Timestamp</th>
                <th className="px-3 py-2 font-medium">Actor</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 font-medium">Entity</th>
                <th className="px-3 py-2 font-medium">Reference</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-border divide-y" aria-busy={isPending}>
              {events.map((event) => (
                // Phase 13 accessibility fix: this previously used
                // `opacity-60` to signal "refreshing" — CSS opacity dims
                // TEXT along with everything else, and axe-core caught
                // it dropping this row's text contrast to 2.87:1 against
                // WCAG 2 AA's 4.5:1 minimum (the --color-muted-foreground
                // token above was deliberately tuned in Phase 7 to
                // comfortably pass AA at full opacity — opacity-60
                // silently undid that). A background-only tint
                // communicates the same "stale, refreshing" state
                // without touching foreground/text contrast at all.
                <tr key={event.id} className={isPending ? "bg-muted/60" : undefined}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {formatTimestamp(event.occurredAt)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {actorLabel(event)}
                    {event.actorType === "SYSTEM" ? (
                      <span className="text-muted-foreground ml-1 text-xs">(automated)</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Badge variant={actionVariant(event.action)}>{event.action}</Badge>
                  </td>
                  <td className="text-muted-foreground px-3 py-2 whitespace-nowrap">
                    {event.category}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{event.entityType}</td>
                  <td className="text-muted-foreground px-3 py-2">
                    {event.entityDisplayReference ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openDetail(event.id)}
                    >
                      View Details
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && events.length > 0 ? (
        <Pagination
          page={page}
          pageSize={DEFAULT_AUDIT_PAGE_SIZE}
          totalCount={total}
          onPageChange={setPage}
        />
      ) : null}

      <Dialog
        open={detailLoading || selectedEvent !== null}
        onOpenChange={(open) => !open && setSelectedEvent(null)}
      >
        <DialogContent
          title="Audit event details"
          description="Timestamp, actor, and a safe before/after comparison."
        >
          {detailLoading ? (
            <LoadingState label="Loading details…" />
          ) : detailError ? (
            <p role="alert" className="text-destructive text-sm font-medium">
              {detailError}
            </p>
          ) : selectedEvent ? (
            <div className="flex flex-col gap-4 text-sm">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                <dt className="text-muted-foreground">Timestamp</dt>
                <dd>{formatTimestamp(selectedEvent.occurredAt)}</dd>
                <dt className="text-muted-foreground">Actor</dt>
                <dd>{actorLabel(selectedEvent)}</dd>
                <dt className="text-muted-foreground">Action</dt>
                <dd>
                  <Badge variant={actionVariant(selectedEvent.action)}>
                    {selectedEvent.action}
                  </Badge>
                </dd>
                <dt className="text-muted-foreground">Category</dt>
                <dd>{selectedEvent.category}</dd>
                <dt className="text-muted-foreground">Entity</dt>
                <dd>
                  {selectedEvent.entityType}
                  {selectedEvent.entityDisplayReference
                    ? ` — ${selectedEvent.entityDisplayReference}`
                    : ""}
                </dd>
                <dt className="text-muted-foreground">Correlation ID</dt>
                <dd className="font-mono text-xs break-all">
                  {selectedEvent.correlationId ?? "—"}
                </dd>
              </dl>

              {selectedEvent.changedFields ? (
                <div>
                  <p className="text-foreground mb-1 font-medium">Changed fields</p>
                  <div className="flex flex-wrap gap-1">
                    {(selectedEvent.changedFields as string[]).map((field) => (
                      <Badge key={field} variant="outline">
                        {field}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-foreground mb-1 font-medium">Before</p>
                  <pre className="bg-muted max-h-64 overflow-auto rounded-md p-2 text-xs">
                    {readableJson(selectedEvent.beforeData)}
                  </pre>
                </div>
                <div>
                  <p className="text-foreground mb-1 font-medium">After</p>
                  <pre className="bg-muted max-h-64 overflow-auto rounded-md p-2 text-xs">
                    {readableJson(selectedEvent.afterData)}
                  </pre>
                </div>
              </div>

              {selectedEvent.safeMetadata ? (
                <div>
                  <p className="text-foreground mb-1 font-medium">Additional details</p>
                  <pre className="bg-muted max-h-40 overflow-auto rounded-md p-2 text-xs">
                    {readableJson(selectedEvent.safeMetadata)}
                  </pre>
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
