"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import type { Department, Employee } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingState } from "@/components/patterns/loading-state";
import { Pagination } from "@/components/patterns/pagination";
import { DEFAULT_PAGE_SIZE } from "@/lib/validation/pagination";
import { parseEnumParam, parseUuidParam } from "@/lib/utils/search-params";
import { ASSIGNMENT_STATUS_LABEL, assignmentDisplayStatus } from "@/lib/domain/employee-status";
import {
  listDepartmentOptionsAction,
  listEmployeesAction,
  type EmployeeListPayload,
} from "@/app/(app)/employees/actions";
import { EmployeeFormDialog } from "@/app/(app)/employees/_components/employee-form-dialog";

interface EmployeesViewProps {
  canManage: boolean;
}

type StatusFilter = "ALL" | "ACTIVE" | "TRANSFERRED" | "TERMINATED";
type AssignmentFilter = "ALL" | "assigned" | "unassigned";

const EMPLOYMENT_STATUS_BADGE: Record<
  Employee["employmentStatus"],
  "success" | "muted" | "destructive"
> = {
  ACTIVE: "success",
  TRANSFERRED: "muted",
  TERMINATED: "destructive",
};

function displayName(employee: Employee): string {
  return employee.preferredName?.trim() || `${employee.firstName} ${employee.lastName}`;
}

const STATUS_FILTER_VALUES: readonly StatusFilter[] = [
  "ALL",
  "ACTIVE",
  "TRANSFERRED",
  "TERMINATED",
];
const ASSIGNMENT_FILTER_VALUES: readonly AssignmentFilter[] = ["ALL", "assigned", "unassigned"];

export function EmployeesView({ canManage }: EmployeesViewProps) {
  // Deep-link support (e.g. from the Dashboard's "Active Employees" or
  // "Unassigned" links, docs/DASHBOARD_METRICS.md) — seeds initial filter
  // state only, once, from the URL; see the identical pattern/rationale
  // in positions-view.tsx.
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [status, setStatus] = useState<StatusFilter>(() =>
    parseEnumParam(searchParams.get("status"), STATUS_FILTER_VALUES, "ALL")
  );
  const [assignment, setAssignment] = useState<AssignmentFilter>(() =>
    parseEnumParam(searchParams.get("assignment"), ASSIGNMENT_FILTER_VALUES, "ALL")
  );
  const [departmentFilter, setDepartmentFilter] = useState(() =>
    parseUuidParam(searchParams.get("department"))
  );
  const [page, setPage] = useState(1);

  const [payload, setPayload] = useState<EmployeeListPayload | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    void (async () => {
      const [listResult, deptResult] = await Promise.all([
        listEmployeesAction({
          search: search || undefined,
          status: status === "ALL" ? undefined : status,
          assignment: assignment === "ALL" ? undefined : assignment,
          departmentId: departmentFilter || undefined,
          page,
          pageSize: DEFAULT_PAGE_SIZE,
        }),
        listDepartmentOptionsAction(),
      ]);
      setLoading(false);
      if (!listResult.ok) {
        setError(listResult.error);
        return;
      }
      setPayload(listResult.data);
      if (deptResult.ok) setDepartments(deptResult.data);
    })();
  }, [search, status, assignment, departmentFilter, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  const employees = payload?.items ?? [];

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="employee-search" className="text-foreground text-sm font-medium">
              Search
            </label>
            <Input
              id="employee-search"
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
              placeholder="Search by name, code, or email…"
              className="sm:w-64"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="employee-status-filter" className="text-foreground text-sm font-medium">
              Employee status
            </label>
            <Select
              id="employee-status-filter"
              value={status}
              onChange={(event) => {
                setPage(1);
                setStatus(event.target.value as StatusFilter);
              }}
              className="sm:w-40"
            >
              <option value="ALL">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="TRANSFERRED">Transferred</option>
              <option value="TERMINATED">Terminated</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="employee-assignment-filter"
              className="text-foreground text-sm font-medium"
            >
              Assignment
            </label>
            <Select
              id="employee-assignment-filter"
              value={assignment}
              onChange={(event) => {
                setPage(1);
                setAssignment(event.target.value as AssignmentFilter);
              }}
              className="sm:w-40"
            >
              <option value="ALL">All employees</option>
              <option value="assigned">Assigned</option>
              <option value="unassigned">Unassigned</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="employee-department-filter"
              className="text-foreground text-sm font-medium"
            >
              Department
            </label>
            <Select
              id="employee-department-filter"
              value={departmentFilter}
              onChange={(event) => {
                setPage(1);
                setDepartmentFilter(event.target.value);
              }}
              className="sm:w-48"
            >
              <option value="">All departments</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {canManage ? (
          <Button type="button" onClick={() => setFormOpen(true)}>
            <Plus aria-hidden="true" className="size-4" />
            Add Employee
          </Button>
        ) : null}
      </div>

      {loading ? (
        <LoadingState label="Loading employees…" />
      ) : error ? (
        <ErrorState description={error} onRetry={refresh} />
      ) : employees.length === 0 ? (
        <EmptyState
          title={
            search || status !== "ALL" || assignment !== "ALL" || departmentFilter
              ? "No matching employees"
              : "No employees yet"
          }
          description={
            search || status !== "ALL" || assignment !== "ALL" || departmentFilter
              ? "Try a different search term or filter."
              : canManage
                ? "Create the first employee record to get started."
                : "No employee records exist yet."
          }
        />
      ) : (
        <div className="border-border overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <caption className="sr-only">Employees</caption>
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Name
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Code
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Current position
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Department
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Level
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Assignment
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {employees.map((employee) => {
                const current = payload?.currentAssignments[employee.id] ?? null;
                const department = current
                  ? departments.find((d) => d.id === current.position.departmentId)
                  : null;
                const displayStatus = assignmentDisplayStatus(
                  employee.employmentStatus,
                  Boolean(current),
                  false
                );
                return (
                  <tr key={employee.id}>
                    <td className="px-4 py-2 font-medium">
                      <Link
                        href={`/employees/${employee.id}`}
                        className="hover:underline focus-visible:underline"
                      >
                        {displayName(employee)}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{employee.employeeCode}</td>
                    <td className="px-4 py-2">
                      {current?.position.title ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-2">
                      {department?.name ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-2">
                      {current?.position.organizationalLevel ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={EMPLOYMENT_STATUS_BADGE[employee.employmentStatus]}>
                        {employee.employmentStatus === "ACTIVE"
                          ? "Active"
                          : employee.employmentStatus === "TRANSFERRED"
                            ? "Transferred"
                            : "Terminated"}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={displayStatus === "assigned" ? "success" : "outline"}>
                        {ASSIGNMENT_STATUS_LABEL[displayStatus]}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && employees.length > 0 && payload ? (
        <Pagination
          page={page}
          pageSize={DEFAULT_PAGE_SIZE}
          totalCount={payload.totalCount}
          onPageChange={setPage}
        />
      ) : null}

      {canManage ? (
        <EmployeeFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          employee={null}
          onSaved={refresh}
        />
      ) : null}
    </div>
  );
}
