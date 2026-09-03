"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import {
  downloadExportFileAction,
  requestExportAction,
  type SafeExportJob,
} from "@/app/(app)/organogram/export-actions";
import type { OrganogramFilterState } from "@/lib/domain/organogram-filters";
import type { OrganogramNode } from "@/lib/domain/organogram";
import type { DescendantDepth } from "@/lib/domain/organogram-focus";
import {
  estimatePngSafeNodeCount,
  type ExportFilterState,
  type ExportFormat,
  type ExportScope,
  type PdfLayoutMode,
  type PdfPageSize,
  type PngScale,
} from "@/lib/domain/export/types";

interface OrganogramExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodes: OrganogramNode[];
  departmentEntries: { id: string; name: string }[];
  currentContext: {
    view: "full" | "position" | "department";
    positionId: string | null;
    departmentId: string | null;
    depth: DescendantDepth;
    filters: OrganogramFilterState;
    showPlanned: boolean;
  };
}

function toExportFilterState(filters: OrganogramFilterState): ExportFilterState {
  return {
    departmentIds: [...filters.departmentIds],
    levels: [...filters.levels],
    jobGradeIds: [...filters.jobGradeIds],
    occupancy: filters.occupancy,
    statuses: [...filters.statuses],
  };
}

function triggerBrowserDownload(base64: string, filename: string, contentType: string) {
  const byteChars = atob(base64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
  const blob = new Blob([bytes], { type: contentType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Requests and downloads a server-rendered organogram export. Generation
 * is synchronous (export.service.ts) — there is no background job queue
 * in this app — so a single "Generate export" click both creates the job
 * and (on success) immediately offers its download, without a separate
 * polling step. Reuses the exact same scope/filter state already active
 * on the interactive chart for the "Current View" option, never
 * re-deriving it independently (docs/adr/0013).
 */
export function OrganogramExportDialog({
  open,
  onOpenChange,
  nodes,
  departmentEntries,
  currentContext,
}: OrganogramExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>("PDF");
  const [scope, setScope] = useState<ExportScope>("FULL_COMPANY");
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string | null>(null);
  const [descendantDepth, setDescendantDepth] = useState<DescendantDepth>(2);
  const [includePlanned, setIncludePlanned] = useState(true);
  const [pageSize, setPageSize] = useState<PdfPageSize>("A3");
  const [pdfLayoutMode, setPdfLayoutMode] = useState<PdfLayoutMode>("AUTO");
  const [pngScale, setPngScale] = useState<PngScale>(2);
  const [includeLegend, setIncludeLegend] = useState(true);
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [includeConfidentialityLabel, setIncludeConfidentialityLabel] = useState(true);

  const [phase, setPhase] = useState<"form" | "generating" | "done" | "error">("form");
  const [job, setJob] = useState<SafeExportJob | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  // Resets the whole form to the interactive chart's current scope/focus
  // every time the dialog opens — not a state update in response to a
  // React value changing mid-render, but a one-shot reinitialization
  // gated on the `open` transition itself, the same documented pattern
  // organogram-view.tsx already uses for its own open/reset effects.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setPhase("form");
    setJob(null);
    setErrorMessage(null);
    setScope(currentContext.view === "full" ? "FULL_COMPANY" : "CURRENT_VIEW");
    setSelectedPositionId(currentContext.positionId);
    setSelectedDepartmentId(currentContext.departmentId);
    setDescendantDepth(currentContext.depth);
    setIncludePlanned(currentContext.showPlanned);
  }, [open, currentContext]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const sortedPositions = useMemo(
    () => [...nodes].sort((a, b) => a.title.localeCompare(b.title)),
    [nodes]
  );

  const scopeNeedsPosition = scope === "POSITION_FOCUS";
  const scopeNeedsDepartment = scope === "DEPARTMENT_FOCUS";

  // Phase 13.1 (DEF-010 remediation) — a client-side-only ESTIMATE for
  // proactive guidance; the real, authoritative limit is enforced
  // server-side against actual post-layout pixel dimensions
  // (lib/domain/export/png-renderer.ts's MAX_PNG_SAFE_TOTAL_PIXELS, via
  // requestExportAction). Narrower scopes (Position/Department Focus)
  // render fewer nodes than the full company, so `nodes.length` here is
  // always an upper bound — safe to over-warn, never used to block the
  // button, since the server check is what actually protects the
  // request.
  const estimatedNodeCount = nodes.length;
  const pngSafeNodeEstimate = estimatePngSafeNodeCount(pngScale);
  const pngLikelyExceedsSafeLimit = format === "PNG" && estimatedNodeCount > pngSafeNodeEstimate;

  const canSubmit =
    (!scopeNeedsPosition || Boolean(selectedPositionId)) &&
    (!scopeNeedsDepartment || Boolean(selectedDepartmentId));

  async function handleGenerate() {
    setPhase("generating");
    setErrorMessage(null);
    const result = await requestExportAction({
      format,
      scope,
      selectedPositionId:
        scope === "POSITION_FOCUS" ? selectedPositionId : currentContext.positionId,
      selectedDepartmentId:
        scope === "DEPARTMENT_FOCUS" ? selectedDepartmentId : currentContext.departmentId,
      descendantDepth,
      includePlanned,
      filters: toExportFilterState(currentContext.filters),
      pageSize,
      pdfLayoutMode,
      pngScale,
      includeLegend,
      includeMetadata,
      includeConfidentialityLabel,
    });
    if (!result.ok) {
      setErrorMessage(result.error);
      setPhase("error");
      return;
    }
    if (result.data.status !== "COMPLETED") {
      setErrorMessage(result.data.errorMessage ?? "The export could not be generated.");
      setPhase("error");
      return;
    }
    setJob(result.data);
    setPhase("done");
  }

  async function handleDownload() {
    if (!job) return;
    setDownloading(true);
    const result = await downloadExportFileAction({ jobId: job.id });
    setDownloading(false);
    if (!result.ok) {
      setErrorMessage(result.error);
      return;
    }
    triggerBrowserDownload(result.data.base64, result.data.filename, result.data.contentType);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Export organization chart"
        description="Generates a PDF or PNG of the organogram, rendered server-side from the same hierarchy shown here."
      >
        {phase === "done" && job ? (
          <div className="flex flex-col gap-4">
            <p className="text-foreground text-sm">
              Your {job.format} export is ready
              {job.pageCount ? ` (${job.pageCount} page${job.pageCount === 1 ? "" : "s"})` : ""}.
            </p>
            <Button type="button" onClick={handleDownload} disabled={downloading}>
              {downloading ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <Download aria-hidden="true" className="size-4" />
              )}
              Download {job.generatedFilename}
            </Button>
            {errorMessage ? (
              <p role="alert" className="text-destructive text-sm font-medium">
                {errorMessage}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPhase("form")}>
                Generate another
              </Button>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Field label="Format">
              {(fieldProps) => (
                <Select
                  {...fieldProps}
                  value={format}
                  onChange={(e) => setFormat(e.target.value as ExportFormat)}
                >
                  <option value="PDF">PDF</option>
                  <option value="PNG">PNG (image)</option>
                </Select>
              )}
            </Field>

            <Field label="Scope">
              {(fieldProps) => (
                <Select
                  {...fieldProps}
                  value={scope}
                  onChange={(e) => setScope(e.target.value as ExportScope)}
                >
                  <option value="FULL_COMPANY">Full Company</option>
                  <option value="CURRENT_VIEW">Current View (as shown on screen)</option>
                  <option value="POSITION_FOCUS">Position Focus</option>
                  <option value="DEPARTMENT_FOCUS">Department Focus</option>
                </Select>
              )}
            </Field>

            {scopeNeedsPosition ? (
              <Field label="Position" required>
                {(fieldProps) => (
                  <Select
                    {...fieldProps}
                    value={selectedPositionId ?? ""}
                    onChange={(e) => setSelectedPositionId(e.target.value || null)}
                  >
                    <option value="">Select a position…</option>
                    {sortedPositions.map((n) => (
                      <option key={n.positionId} value={n.positionId}>
                        {n.title} ({n.positionCode})
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}

            {scopeNeedsPosition ? (
              <Field
                label="Descendant depth"
                hint="How many reporting levels below the position to include."
              >
                {(fieldProps) => (
                  <Select
                    {...fieldProps}
                    value={String(descendantDepth)}
                    onChange={(e) =>
                      setDescendantDepth(
                        e.target.value === "all"
                          ? "all"
                          : (Number(e.target.value) as DescendantDepth)
                      )
                    }
                  >
                    <option value="1">1 level</option>
                    <option value="2">2 levels</option>
                    <option value="3">3 levels</option>
                    <option value="all">All descendants</option>
                  </Select>
                )}
              </Field>
            ) : null}

            {scopeNeedsDepartment ? (
              <Field label="Department" required>
                {(fieldProps) => (
                  <Select
                    {...fieldProps}
                    value={selectedDepartmentId ?? ""}
                    onChange={(e) => setSelectedDepartmentId(e.target.value || null)}
                  >
                    <option value="">Select a department…</option>
                    {departmentEntries.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}

            {format === "PDF" ? (
              <>
                <Field label="Page size">
                  {(fieldProps) => (
                    <Select
                      {...fieldProps}
                      value={pageSize}
                      onChange={(e) => setPageSize(e.target.value as PdfPageSize)}
                    >
                      <option value="A3">A3 landscape (default)</option>
                      <option value="A4">A4 landscape</option>
                    </Select>
                  )}
                </Field>
                <Field label="Layout">
                  {(fieldProps) => (
                    <Select
                      {...fieldProps}
                      value={pdfLayoutMode}
                      onChange={(e) => setPdfLayoutMode(e.target.value as PdfLayoutMode)}
                    >
                      <option value="AUTO">Auto (fit to one page when possible)</option>
                      <option value="SINGLE_PAGE">Single page (shrink to fit)</option>
                      <option value="MULTI_PAGE_TILED">Multi-page tiled (full detail)</option>
                    </Select>
                  )}
                </Field>
              </>
            ) : (
              <>
                <Field label="Image scale">
                  {(fieldProps) => (
                    <Select
                      {...fieldProps}
                      value={String(pngScale)}
                      onChange={(e) => setPngScale(Number(e.target.value) as PngScale)}
                    >
                      <option value="1">1x</option>
                      <option value="2">2x (default)</option>
                      <option value="3">3x</option>
                    </Select>
                  )}
                </Field>
                {pngLikelyExceedsSafeLimit ? (
                  <p
                    role="alert"
                    className="text-sm font-medium text-amber-600 dark:text-amber-500"
                  >
                    This chart (~{estimatedNodeCount} positions) is large for a PNG at this scale
                    and may be rejected or take too long to render. Try PDF instead — it supports
                    this scale via multi-page tiling — a lower image scale, or a narrower scope (a
                    department or position focus).
                  </p>
                ) : null}
              </>
            )}

            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includePlanned}
                  onChange={(e) => setIncludePlanned(e.target.checked)}
                  className="accent-primary size-4"
                />
                Include planned positions
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeLegend}
                  onChange={(e) => setIncludeLegend(e.target.checked)}
                  className="accent-primary size-4"
                />
                Include legend
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeMetadata}
                  onChange={(e) => setIncludeMetadata(e.target.checked)}
                  className="accent-primary size-4"
                />
                Include company name and generated-date header
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeConfidentialityLabel}
                  onChange={(e) => setIncludeConfidentialityLabel(e.target.checked)}
                  className="accent-primary size-4"
                />
                Include &quot;Confidential&quot; label
              </label>
            </div>

            {errorMessage ? (
              <p role="alert" className="text-destructive text-sm font-medium">
                {errorMessage}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleGenerate}
                disabled={!canSubmit || phase === "generating"}
              >
                {phase === "generating" ? (
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                ) : null}
                Generate export
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
