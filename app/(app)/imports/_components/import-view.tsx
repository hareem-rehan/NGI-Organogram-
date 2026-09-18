"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { ImportJob, ImportRowIssue } from "@prisma/client";
import { AlertTriangle, CheckCircle2, Download, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { LoadingState } from "@/components/patterns/loading-state";
import {
  cancelImportAction,
  confirmImportAction,
  downloadImportErrorReportAction,
  downloadImportTemplateAction,
  executeImportAction,
  getImportRowIssuesAction,
  listImportJobsAction,
  uploadImportAction,
  validateImportAction,
} from "@/app/(app)/imports/actions";

type ImportType = "DEPARTMENT" | "POSITION" | "EMPLOYEE" | "ASSIGNMENT";
type ImportMode = "CREATE_ONLY" | "UPSERT";

const IMPORT_TYPE_OPTIONS: { value: ImportType; label: string }[] = [
  { value: "DEPARTMENT", label: "Departments" },
  { value: "POSITION", label: "Positions" },
  { value: "EMPLOYEE", label: "Employees" },
  { value: "ASSIGNMENT", label: "Position Assignments" },
];

interface DisplayRowPlanEntry {
  rowNumber: number;
  matchingCode: string;
  action: "CREATE" | "UPDATE" | "UNCHANGED" | "ERROR";
  diffs: { field: string; currentValue: string | null; proposedValue: string | null }[];
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function statusBadgeVariant(
  status: string
): "default" | "success" | "destructive" | "warning" | "muted" {
  if (status === "COMPLETED") return "success";
  if (status === "FAILED" || status === "VALIDATION_FAILED") return "destructive";
  if (status === "READY_TO_EXECUTE" || status === "VALIDATED") return "warning";
  if (status === "CANCELLED" || status === "EXPIRED") return "muted";
  return "default";
}

export function ImportView() {
  const [importType, setImportType] = useState<ImportType>("DEPARTMENT");
  const [importMode, setImportMode] = useState<ImportMode>("UPSERT");
  const [job, setJob] = useState<ImportJob | null>(null);
  const [issues, setIssues] = useState<ImportRowIssue[]>([]);
  const [recentJobs, setRecentJobs] = useState<ImportJob[]>([]);
  const [recentJobsLoading, setRecentJobsLoading] = useState(true);
  const [acknowledgeWarnings, setAcknowledgeWarnings] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshRecentJobs = useCallback(async () => {
    const result = await listImportJobsAction();
    if (result.ok) setRecentJobs(result.data);
  }, []);

  useEffect(() => {
    // Fetching the recent-jobs list on mount is exactly what this effect
    // is for; `refreshRecentJobs` is also reused as a shared post-action
    // callback (after upload/confirm/execute/cancel), so it can't be
    // inlined here without duplicating the fetch logic — same accepted
    // pattern as departments-view.tsx's own `refresh`.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshRecentJobs().finally(() => setRecentJobsLoading(false));
  }, [refreshRecentJobs]);

  const refreshIssues = useCallback(async (jobId: string) => {
    const result = await getImportRowIssuesAction({ jobId });
    if (result.ok) setIssues(result.data);
  }, []);

  function resetWizard() {
    setJob(null);
    setIssues([]);
    setAcknowledgeWarnings(false);
    setStatusMessage(null);
    setErrorMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleDownloadTemplate() {
    setErrorMessage(null);
    const result = await downloadImportTemplateAction({ importType });
    if (result.ok) {
      downloadCsv(result.data.filename, result.data.content);
    } else {
      setErrorMessage(result.error);
    }
  }

  function handleFileSelected(file: File) {
    setErrorMessage(null);
    setStatusMessage(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("importType", importType);
      formData.set("importMode", importMode);

      const uploaded = await uploadImportAction(formData);
      if (!uploaded.ok) {
        setErrorMessage(uploaded.error);
        return;
      }

      const validated = await validateImportAction({ jobId: uploaded.data.id });
      if (!validated.ok) {
        setErrorMessage(validated.error);
        return;
      }
      setJob(validated.data);
      await refreshIssues(validated.data.id);
      await refreshRecentJobs();
    });
  }

  function handleConfirm() {
    if (!job) return;
    setErrorMessage(null);
    startTransition(async () => {
      const result = await confirmImportAction({ jobId: job.id, acknowledgeWarnings });
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }
      setJob(result.data);
      await refreshRecentJobs();
    });
  }

  function handleExecute() {
    if (!job) return;
    setErrorMessage(null);
    startTransition(async () => {
      const result = await executeImportAction({ jobId: job.id });
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }
      setJob(result.data.job);
      if (result.data.stale) {
        await refreshIssues(result.data.job.id);
        setStatusMessage(null);
      } else if (result.data.job.status === "COMPLETED") {
        setStatusMessage(
          `Import complete: ${result.data.job.createCount} created, ${result.data.job.updateCount} updated, ${result.data.job.unchangedCount} unchanged.`
        );
      }
      await refreshRecentJobs();
    });
  }

  function handleCancel() {
    if (!job) return;
    startTransition(async () => {
      const result = await cancelImportAction({ jobId: job.id });
      if (result.ok) setJob(result.data);
      await refreshRecentJobs();
    });
  }

  async function handleDownloadErrorReport() {
    if (!job) return;
    const result = await downloadImportErrorReportAction({ jobId: job.id });
    if (result.ok) downloadCsv(result.data.filename, result.data.content);
  }

  const rowPlan: DisplayRowPlanEntry[] = Array.isArray(job?.rowPlan)
    ? (job.rowPlan as unknown as DisplayRowPlanEntry[])
    : [];
  const rowLevelIssuesByRow = new Map<number, ImportRowIssue[]>();
  const fileLevelIssues: ImportRowIssue[] = [];
  for (const issue of issues) {
    if (issue.rowNumber === 0) {
      fileLevelIssues.push(issue);
    } else {
      const list = rowLevelIssuesByRow.get(issue.rowNumber) ?? [];
      list.push(issue);
      rowLevelIssuesByRow.set(issue.rowNumber, list);
    }
  }

  const isFinalState = job
    ? ["COMPLETED", "FAILED", "CANCELLED", "EXPIRED"].includes(job.status)
    : false;

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="import-jobs-heading" className="flex flex-col gap-3">
        <h2 id="import-jobs-heading" className="text-foreground text-sm font-semibold">
          Recent Imports
        </h2>
        {recentJobsLoading ? (
          <LoadingState label="Loading recent imports…" />
        ) : recentJobs.length === 0 ? (
          <p className="text-muted-foreground text-sm">No imports yet.</p>
        ) : (
          <div className="border-border overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Type
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Mode
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Rows
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Created
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Result
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentJobs.map((recentJob) => (
                  <tr key={recentJob.id} className="border-border border-t">
                    <td className="px-3 py-2">{recentJob.importType}</td>
                    <td className="px-3 py-2">{recentJob.importMode}</td>
                    <td className="px-3 py-2">
                      <Badge variant={statusBadgeVariant(recentJob.status)}>
                        {recentJob.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">{recentJob.totalRows}</td>
                    <td className="px-3 py-2">{new Date(recentJob.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      {recentJob.status === "COMPLETED"
                        ? `${recentJob.createCount} created, ${recentJob.updateCount} updated`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section
        aria-labelledby="import-wizard-heading"
        className="border-border flex flex-col gap-5 rounded-lg border p-5"
      >
        <h2 id="import-wizard-heading" className="text-foreground text-sm font-semibold">
          New Import
        </h2>

        {errorMessage ? (
          <p
            role="alert"
            className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
          >
            {errorMessage}
          </p>
        ) : null}

        {!job ? (
          <>
            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="flex flex-1 flex-col gap-1.5">
                <label htmlFor="import-type" className="text-foreground text-sm font-medium">
                  Import type
                </label>
                <Select
                  id="import-type"
                  value={importType}
                  onChange={(e) => setImportType(e.target.value as ImportType)}
                  disabled={isPending}
                >
                  {IMPORT_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <label htmlFor="import-mode" className="text-foreground text-sm font-medium">
                  Mode
                </label>
                <Select
                  id="import-mode"
                  value={importMode}
                  onChange={(e) => setImportMode(e.target.value as ImportMode)}
                  disabled={isPending || importType === "ASSIGNMENT"}
                >
                  <option value="UPSERT">Create or update (UPSERT)</option>
                  <option value="CREATE_ONLY">Create only</option>
                </Select>
                {importType === "ASSIGNMENT" ? (
                  <p className="text-muted-foreground text-xs">
                    Assignment imports use an explicit operation column
                    (ASSIGN/TRANSFER/END_ASSIGNMENT) instead of a create/update mode.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" onClick={handleDownloadTemplate}>
                <Download aria-hidden="true" />
                Download template
              </Button>

              <label className="border-border hover:bg-accent focus-within:ring-ring inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors focus-within:ring-2 focus-within:ring-offset-2">
                <Upload aria-hidden="true" className="size-4" />
                {isPending ? "Uploading…" : "Upload CSV file"}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  disabled={isPending}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelected(file);
                  }}
                />
              </label>
            </div>
            <p className="text-muted-foreground text-xs">
              Maximum 10MB, up to 5,000 data rows. Uploading a file never changes any data — you
              will review a full preview first.
            </p>
          </>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusBadgeVariant(job.status)}>
                {job.status.replace(/_/g, " ")}
              </Badge>
              <span className="text-muted-foreground text-sm">{job.originalFilename}</span>
            </div>

            {job.status === "VALIDATION_FAILED" ||
            job.status === "VALIDATED" ||
            job.status === "READY_TO_EXECUTE" ? (
              <div className="flex flex-wrap gap-4 text-sm">
                <span>{job.totalRows} total rows</span>
                <span className="text-status-filled">{job.createCount} create</span>
                <span className="text-status-planned-foreground">{job.updateCount} update</span>
                <span className="text-muted-foreground">{job.unchangedCount} unchanged</span>
                {job.errorRows > 0 ? (
                  <span className="text-destructive font-medium">
                    {job.errorRows} error{job.errorRows === 1 ? "" : "s"}
                  </span>
                ) : null}
                {job.warningRows > 0 ? (
                  <span className="text-status-planned-foreground font-medium">
                    {job.warningRows} warning{job.warningRows === 1 ? "" : "s"}
                  </span>
                ) : null}
              </div>
            ) : null}

            {statusMessage ? (
              <p
                role="status"
                className="border-status-filled/40 bg-status-filled/10 text-status-filled flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <CheckCircle2 aria-hidden="true" className="size-4" />
                {statusMessage}
              </p>
            ) : null}

            {fileLevelIssues.length > 0 ? (
              <div className="flex flex-col gap-1">
                {fileLevelIssues.map((issue) => (
                  <p
                    key={issue.id}
                    role={issue.severity === "ERROR" ? "alert" : "status"}
                    className={
                      issue.severity === "ERROR"
                        ? "border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
                        : "border-status-planned/40 bg-status-planned/10 text-status-planned-foreground rounded-md border px-3 py-2 text-sm"
                    }
                  >
                    <AlertTriangle aria-hidden="true" className="mr-1.5 inline size-3.5" />
                    {issue.safeMessage}
                  </p>
                ))}
              </div>
            ) : null}

            {rowPlan.length > 0 ? (
              <div className="border-border max-h-96 overflow-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-muted-foreground sticky top-0">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left font-medium">
                        Row
                      </th>
                      <th scope="col" className="px-3 py-2 text-left font-medium">
                        Code
                      </th>
                      <th scope="col" className="px-3 py-2 text-left font-medium">
                        Action
                      </th>
                      <th scope="col" className="px-3 py-2 text-left font-medium">
                        Details
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowPlan.map((row) => {
                      const rowIssues = rowLevelIssuesByRow.get(row.rowNumber) ?? [];
                      return (
                        <tr key={row.rowNumber} className="border-border border-t align-top">
                          <td className="px-3 py-2">{row.rowNumber}</td>
                          <td className="px-3 py-2 font-mono text-xs">{row.matchingCode}</td>
                          <td className="px-3 py-2">
                            <Badge
                              variant={
                                row.action === "ERROR"
                                  ? "destructive"
                                  : row.action === "CREATE"
                                    ? "success"
                                    : row.action === "UPDATE"
                                      ? "warning"
                                      : "muted"
                              }
                            >
                              {row.action}
                            </Badge>
                          </td>
                          <td className="px-3 py-2">
                            {rowIssues.length > 0 ? (
                              <ul className="text-destructive flex flex-col gap-0.5">
                                {rowIssues.map((issue) => (
                                  <li key={issue.id}>{issue.safeMessage}</li>
                                ))}
                              </ul>
                            ) : row.diffs.length > 0 ? (
                              <ul className="text-muted-foreground flex flex-col gap-0.5">
                                {row.diffs.map((diff) => (
                                  <li key={diff.field}>
                                    <span className="font-medium">{diff.field}</span>:{" "}
                                    {diff.currentValue ?? "—"} → {diff.proposedValue ?? "—"}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <span className="text-muted-foreground">No change</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              {job.status === "VALIDATED" ? (
                <>
                  {job.warningRows > 0 ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={acknowledgeWarnings}
                        onChange={(e) => setAcknowledgeWarnings(e.target.checked)}
                      />
                      I have reviewed the {job.warningRows} warning
                      {job.warningRows === 1 ? "" : "s"} above.
                    </label>
                  ) : null}
                  <Button
                    type="button"
                    onClick={handleConfirm}
                    disabled={isPending || (job.warningRows > 0 && !acknowledgeWarnings)}
                  >
                    Confirm import
                  </Button>
                </>
              ) : null}

              {job.status === "READY_TO_EXECUTE" ? (
                <Button type="button" onClick={handleExecute} disabled={isPending}>
                  {isPending ? "Executing…" : "Execute import"}
                </Button>
              ) : null}

              {job.status === "VALIDATION_FAILED" && job.errorRows > 0 ? (
                <Button type="button" variant="outline" onClick={handleDownloadErrorReport}>
                  <Download aria-hidden="true" />
                  Download error report
                </Button>
              ) : null}

              {!isFinalState && job.status !== "READY_TO_EXECUTE" ? (
                <Button type="button" variant="ghost" onClick={handleCancel} disabled={isPending}>
                  Cancel
                </Button>
              ) : null}

              <Button type="button" variant="outline" onClick={resetWizard}>
                Start new import
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
