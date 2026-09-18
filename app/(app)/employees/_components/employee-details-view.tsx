"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingState } from "@/components/patterns/loading-state";
import { ASSIGNMENT_STATUS_LABEL, assignmentDisplayStatus } from "@/lib/domain/employee-status";
import { getEmployeeDetailAction, type EmployeeDetailPayload } from "@/app/(app)/employees/actions";
import { EmployeeFormDialog } from "@/app/(app)/employees/_components/employee-form-dialog";
import { AssignPositionDialog } from "@/app/(app)/employees/_components/assign-position-dialog";
import { TransferEmployeeDialog } from "@/app/(app)/employees/_components/transfer-employee-dialog";
import { EndAssignmentDialog } from "@/app/(app)/employees/_components/end-assignment-dialog";
import { TerminateEmployeeDialog } from "@/app/(app)/employees/_components/terminate-employee-dialog";

interface EmployeeDetailsViewProps {
  employeeId: string;
  canManage: boolean;
}

function displayName(payload: EmployeeDetailPayload): string {
  const { employee } = payload;
  return employee.preferredName?.trim() || `${employee.firstName} ${employee.lastName}`;
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toISOString().slice(0, 10);
}

export function EmployeeDetailsView({ employeeId, canManage }: EmployeeDetailsViewProps) {
  const router = useRouter();
  const [payload, setPayload] = useState<EmployeeDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [terminateOpen, setTerminateOpen] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    void (async () => {
      const result = await getEmployeeDetailAction(employeeId);
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPayload(result.data);
    })();
  }, [employeeId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  if (loading) return <LoadingState label="Loading employee…" />;
  if (error || !payload)
    return <ErrorState description={error ?? "Employee not found."} onRetry={refresh} />;

  const { employee, currentAssignment, managerPositionTitle, history } = payload;
  const hasFutureAssignment = history.some(
    (row) => row.startDate > new Date() && row.endDate === null && !currentAssignment
  );
  const displayStatus = assignmentDisplayStatus(
    employee.employmentStatus,
    Boolean(currentAssignment),
    hasFutureAssignment
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-semibold tracking-tight">
            {displayName(payload)}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {employee.employeeCode}
            {employee.workEmail ? ` · ${employee.workEmail}` : ""}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge
              variant={
                employee.employmentStatus === "ACTIVE"
                  ? "success"
                  : employee.employmentStatus === "TRANSFERRED"
                    ? "muted"
                    : "destructive"
              }
            >
              {employee.employmentStatus === "ACTIVE"
                ? "Active"
                : employee.employmentStatus === "TRANSFERRED"
                  ? "Transferred"
                  : "Terminated"}
            </Badge>
            <Badge variant={displayStatus === "assigned" ? "success" : "outline"}>
              {ASSIGNMENT_STATUS_LABEL[displayStatus]}
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => router.push("/employees")}>
            Back to list
          </Button>
          {canManage ? (
            <Button type="button" variant="outline" onClick={() => setEditOpen(true)}>
              Edit
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <section className="border-border rounded-md border p-4">
          <h2 className="text-foreground text-sm font-semibold">Current position</h2>
          {currentAssignment ? (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Title</dt>
              <dd>{currentAssignment.position.title}</dd>
              <dt className="text-muted-foreground">Code</dt>
              <dd>{currentAssignment.position.positionCode}</dd>
              <dt className="text-muted-foreground">Department</dt>
              <dd>{currentAssignment.department?.name ?? "—"}</dd>
              <dt className="text-muted-foreground">Manager position</dt>
              <dd>{managerPositionTitle ?? "— (root)"}</dd>
              <dt className="text-muted-foreground">Organizational level</dt>
              <dd>{currentAssignment.position.organizationalLevel}</dd>
              <dt className="text-muted-foreground">Assignment start</dt>
              <dd>{formatDate(currentAssignment.startDate)}</dd>
            </dl>
          ) : (
            <p className="text-muted-foreground mt-2 text-sm">
              {employee.employmentStatus === "TERMINATED"
                ? "No position — employment terminated."
                : "This employee is not currently assigned to any position."}
            </p>
          )}
          {canManage && employee.employmentStatus !== "TERMINATED" ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {currentAssignment ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setTransferOpen(true)}
                  >
                    Transfer
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setEndOpen(true)}
                  >
                    End Assignment
                  </Button>
                </>
              ) : (
                <Button type="button" size="sm" onClick={() => setAssignOpen(true)}>
                  Assign to Position
                </Button>
              )}
            </div>
          ) : null}
        </section>

        <section className="border-border rounded-md border p-4">
          <h2 className="text-foreground text-sm font-semibold">Record details</h2>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Preferred name</dt>
            <dd>{employee.preferredName || "—"}</dd>
            <dt className="text-muted-foreground">Joining date</dt>
            <dd>{formatDate(employee.joiningDate)}</dd>
            <dt className="text-muted-foreground">Leaving date</dt>
            <dd>{formatDate(employee.leavingDate)}</dd>
            <dt className="text-muted-foreground">Created</dt>
            <dd>{formatDate(employee.createdAt)}</dd>
            <dt className="text-muted-foreground">Last updated</dt>
            <dd>{formatDate(employee.updatedAt)}</dd>
          </dl>
          {canManage && employee.employmentStatus !== "TERMINATED" ? (
            <div className="mt-3">
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => setTerminateOpen(true)}
              >
                Terminate Employee
              </Button>
            </div>
          ) : null}
        </section>
      </div>

      <section>
        <h2 className="text-foreground text-sm font-semibold">Assignment history</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          Position title, code, and department shown reflect each position&apos;s current record —
          this view does not preserve a historical snapshot of what the position was called or which
          department it belonged to at the time of each assignment.
        </p>
        {history.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-sm">No assignment history yet.</p>
        ) : (
          <div className="border-border mt-2 overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <caption className="sr-only">Assignment history</caption>
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Position
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Start
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    End
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {history.map((row) => {
                  const now = new Date();
                  const rowStatus =
                    row.endDate && row.endDate <= now
                      ? "Historical"
                      : row.startDate > now
                        ? "Future"
                        : "Current";
                  return (
                    <tr key={row.id}>
                      <td className="px-4 py-2">
                        {row.position.title}{" "}
                        <span className="text-muted-foreground">({row.position.positionCode})</span>
                      </td>
                      <td className="px-4 py-2">{formatDate(row.startDate)}</td>
                      <td className="px-4 py-2">{row.endDate ? formatDate(row.endDate) : "—"}</td>
                      <td className="px-4 py-2">
                        <Badge variant={rowStatus === "Current" ? "success" : "outline"}>
                          {rowStatus}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canManage ? (
        <>
          <EmployeeFormDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            employee={employee}
            onSaved={refresh}
          />
          {currentAssignment ? (
            <>
              <TransferEmployeeDialog
                open={transferOpen}
                onOpenChange={setTransferOpen}
                employee={employee}
                currentAssignment={currentAssignment}
                currentDepartmentName={currentAssignment.department?.name ?? null}
                onTransferred={refresh}
              />
              <EndAssignmentDialog
                open={endOpen}
                onOpenChange={setEndOpen}
                employee={employee}
                currentAssignment={currentAssignment}
                onEnded={refresh}
              />
            </>
          ) : (
            <AssignPositionDialog
              open={assignOpen}
              onOpenChange={setAssignOpen}
              employee={employee}
              onAssigned={refresh}
            />
          )}
          <TerminateEmployeeDialog
            open={terminateOpen}
            onOpenChange={setTerminateOpen}
            employee={employee}
            hasActiveAssignment={Boolean(currentAssignment)}
            onTerminated={refresh}
          />
        </>
      ) : null}
    </div>
  );
}
