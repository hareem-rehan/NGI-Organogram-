"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import type { Department } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingState } from "@/components/patterns/loading-state";
import { Pagination } from "@/components/patterns/pagination";
import { ConfirmDialog, useConfirmDialog } from "@/components/patterns/confirm-dialog";
import { DEFAULT_PAGE_SIZE } from "@/lib/validation/pagination";
import { parseEnumParam } from "@/lib/utils/search-params";
import {
  archiveDepartmentAction,
  listAllDepartmentsAction,
  listDepartmentsAction,
  reactivateDepartmentAction,
} from "@/app/(app)/departments/actions";
import { DepartmentFormDialog } from "@/app/(app)/departments/_components/department-form-dialog";

interface DepartmentsViewProps {
  canManage: boolean;
}

type StatusFilter = "ALL" | "ACTIVE" | "INACTIVE";
const STATUS_FILTER_VALUES: readonly StatusFilter[] = ["ALL", "ACTIVE", "INACTIVE"];

export function DepartmentsView({ canManage }: DepartmentsViewProps) {
  // Deep-link support (e.g. from the Dashboard's "Active Departments"
  // card, docs/DASHBOARD_METRICS.md) — seeds initial filter state only,
  // once, from the URL; see the identical pattern/rationale in
  // positions-view.tsx.
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [status, setStatus] = useState<StatusFilter>(() =>
    parseEnumParam(searchParams.get("status"), STATUS_FILTER_VALUES, "ALL")
  );
  const [page, setPage] = useState(1);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [allDepartments, setAllDepartments] = useState<Department[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null);
  const [statusTarget, setStatusTarget] = useState<Department | null>(null);
  const statusDialog = useConfirmDialog();
  const [statusPending, setStatusPending] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    startTransition(async () => {
      const [listResult, allResult] = await Promise.all([
        listDepartmentsAction({
          search: search || undefined,
          status: status === "ALL" ? undefined : status,
          page,
          pageSize: DEFAULT_PAGE_SIZE,
        }),
        listAllDepartmentsAction(),
      ]);
      setLoading(false);
      if (!listResult.ok) {
        setError(listResult.error);
        return;
      }
      setDepartments(listResult.data.items);
      setTotalCount(listResult.data.totalCount);
      if (allResult.ok) setAllDepartments(allResult.data);
    });
  }, [search, status, page]);

  useEffect(() => {
    // Fetching from the server in response to filter/page changes is
    // exactly what this effect is for (syncing the list with the
    // server) — the compiler's set-state-in-effect rule flags the
    // shared `refresh` helper's own setLoading/setError calls, but
    // `refresh` is also reused as a manual retry/post-save callback, so
    // it can't be inlined here without duplicating the fetch logic.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  function openCreate() {
    setEditingDepartment(null);
    setFormOpen(true);
  }

  function openEdit(department: Department) {
    setEditingDepartment(department);
    setFormOpen(true);
  }

  function openStatusChange(department: Department) {
    setStatusTarget(department);
    setStatusError(null);
    statusDialog.setOpen(true);
  }

  async function confirmStatusChange() {
    if (!statusTarget) return;
    setStatusPending(true);
    setStatusError(null);
    const action =
      statusTarget.status === "ACTIVE" ? archiveDepartmentAction : reactivateDepartmentAction;
    const result = await action({ departmentId: statusTarget.id });
    setStatusPending(false);
    if (!result.ok) {
      setStatusError(result.error);
      return;
    }
    statusDialog.setOpen(false);
    refresh();
  }

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="department-search" className="text-foreground text-sm font-medium">
              Search
            </label>
            <Input
              id="department-search"
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
              placeholder="Search by name or code…"
              className="sm:w-64"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="department-status-filter"
              className="text-foreground text-sm font-medium"
            >
              Status
            </label>
            <Select
              id="department-status-filter"
              value={status}
              onChange={(event) => {
                setPage(1);
                setStatus(event.target.value as StatusFilter);
              }}
              className="sm:w-40"
            >
              <option value="ALL">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </Select>
          </div>
        </div>
        {canManage ? (
          <Button type="button" onClick={openCreate}>
            <Plus aria-hidden="true" className="size-4" />
            Add Department
          </Button>
        ) : null}
      </div>

      {loading ? (
        <LoadingState label="Loading departments…" />
      ) : error ? (
        <ErrorState description={error} onRetry={refresh} />
      ) : departments.length === 0 ? (
        <EmptyState
          title={search || status !== "ALL" ? "No matching departments" : "No departments yet"}
          description={
            search || status !== "ALL"
              ? "Try a different search term or status filter."
              : canManage
                ? "Create the first department to get started."
                : "No departments have been created yet."
          }
        />
      ) : (
        <div className="border-border overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <caption className="sr-only">Departments</caption>
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Name
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Code
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Parent
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Status
                </th>
                {canManage ? (
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Actions
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {departments.map((department) => (
                <tr key={department.id}>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      {department.color ? (
                        <span
                          aria-hidden="true"
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: department.color }}
                        />
                      ) : null}
                      <span className="font-medium">{department.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2">{department.code}</td>
                  <td className="px-4 py-2">
                    {allDepartments.find(
                      (candidate) => candidate.id === department.parentDepartmentId
                    )?.name ?? <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={department.status === "ACTIVE" ? "success" : "muted"}>
                      {department.status === "ACTIVE" ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  {canManage ? (
                    <td className="px-4 py-2">
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(department)}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openStatusChange(department)}
                        >
                          {department.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
                        </Button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && departments.length > 0 ? (
        <Pagination
          page={page}
          pageSize={DEFAULT_PAGE_SIZE}
          totalCount={totalCount}
          onPageChange={setPage}
        />
      ) : null}

      {canManage ? (
        <DepartmentFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          department={editingDepartment}
          allDepartments={allDepartments}
          onSaved={refresh}
        />
      ) : null}

      {statusTarget ? (
        <ConfirmDialog
          open={statusDialog.open}
          onOpenChange={statusDialog.setOpen}
          title={
            statusTarget.status === "ACTIVE" ? "Deactivate department?" : "Reactivate department?"
          }
          description={
            statusTarget.status === "ACTIVE"
              ? `${statusTarget.name} will no longer appear as an active department. Positions referencing it are unaffected.`
              : `${statusTarget.name} will become active again.`
          }
          confirmLabel={statusTarget.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
          destructive={statusTarget.status === "ACTIVE"}
          pending={statusPending}
          errorMessage={statusError}
          onConfirm={confirmStatusChange}
        />
      ) : null}

      {isPending ? (
        <span className="sr-only" aria-live="polite">
          Updating results…
        </span>
      ) : null}
    </div>
  );
}
