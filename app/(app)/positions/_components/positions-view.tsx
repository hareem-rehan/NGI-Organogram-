"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import type {
  CareerTrack,
  Department,
  JobFamily,
  JobGrade,
  LevelMappingEntry,
  Position,
} from "@prisma/client";

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
import { parseEnumParam, parseUuidParam } from "@/lib/utils/search-params";
import {
  activatePositionAction,
  archivePositionAction,
  deletePositionAction,
  listAllPositionsAction,
  listDepartmentOptionsAction,
  listJobGradeOptionsAction,
  listPositionCareerOptionsAction,
  listPositionsAction,
} from "@/app/(app)/positions/actions";
import { PositionFormDialog } from "@/app/(app)/positions/_components/position-form-dialog";
import { PositionMoveDialog } from "@/app/(app)/positions/_components/position-move-dialog";

interface PositionsViewProps {
  canManage: boolean;
}

type StatusFilter = "ALL" | "PLANNED" | "ACTIVE" | "INACTIVE";
type OccupancyFilter = "ALL" | "occupied" | "vacant";
const OCCUPANCY_FILTER_VALUES: readonly OccupancyFilter[] = ["ALL", "occupied", "vacant"];

const STATUS_BADGE_VARIANT: Record<Position["status"], "success" | "warning" | "muted"> = {
  ACTIVE: "success",
  PLANNED: "warning",
  INACTIVE: "muted",
};

const STATUS_FILTER_VALUES: readonly StatusFilter[] = ["ALL", "PLANNED", "ACTIVE", "INACTIVE"];

export function PositionsView({ canManage }: PositionsViewProps) {
  // Deep-link support (e.g. from the Dashboard's "Vacant Positions" or
  // "Planned Positions" cards, docs/DASHBOARD_METRICS.md): seeds initial
  // filter state only, once, from the URL. Never re-synced back to the
  // URL afterward — this stays a one-way entry point, not a full
  // URL-driven filter state, matching the minimal scope Phase 7 needs.
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [departmentFilter, setDepartmentFilter] = useState(() =>
    parseUuidParam(searchParams.get("department"))
  );
  const [status, setStatus] = useState<StatusFilter>(() =>
    parseEnumParam(searchParams.get("status"), STATUS_FILTER_VALUES, "ALL")
  );
  const [occupancy, setOccupancy] = useState<OccupancyFilter>(() =>
    parseEnumParam(searchParams.get("occupancy"), OCCUPANCY_FILTER_VALUES, "ALL")
  );
  const [page, setPage] = useState(1);

  const [positions, setPositions] = useState<Position[]>([]);
  const [occupiedIds, setOccupiedIds] = useState<Set<string>>(new Set());
  const [totalCount, setTotalCount] = useState(0);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [jobGrades, setJobGrades] = useState<JobGrade[]>([]);
  const [allPositions, setAllPositions] = useState<Position[]>([]);
  const [jobFamilies, setJobFamilies] = useState<JobFamily[]>([]);
  const [careerTracks, setCareerTracks] = useState<CareerTrack[]>([]);
  const [levelMappingEntries, setLevelMappingEntries] = useState<LevelMappingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  const [editingPosition, setEditingPosition] = useState<Position | null>(null);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [movingPosition, setMovingPosition] = useState<Position | null>(null);
  const [statusTarget, setStatusTarget] = useState<Position | null>(null);
  const statusDialog = useConfirmDialog();
  const [statusPending, setStatusPending] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Position | null>(null);
  const deleteDialog = useConfirmDialog();
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    startTransition(async () => {
      const [listResult, deptResult, gradeResult, allResult, careerResult] = await Promise.all([
        listPositionsAction({
          search: search || undefined,
          departmentId: departmentFilter || undefined,
          status: status === "ALL" ? undefined : status,
          occupancy: occupancy === "ALL" ? undefined : occupancy,
          page,
          pageSize: DEFAULT_PAGE_SIZE,
        }),
        listDepartmentOptionsAction(),
        listJobGradeOptionsAction(),
        listAllPositionsAction(),
        listPositionCareerOptionsAction(),
      ]);
      setLoading(false);
      if (!listResult.ok) {
        setError(listResult.error);
        return;
      }
      setPositions(listResult.data.items);
      setTotalCount(listResult.data.totalCount);
      setOccupiedIds(new Set(listResult.data.occupiedPositionIds));
      if (deptResult.ok) setDepartments(deptResult.data);
      if (gradeResult.ok) setJobGrades(gradeResult.data);
      if (allResult.ok) setAllPositions(allResult.data);
      if (careerResult.ok) {
        setJobFamilies(careerResult.data.jobFamilies);
        setCareerTracks(careerResult.data.careerTracks);
        setLevelMappingEntries(careerResult.data.levelMappingEntries);
      }
    });
  }, [search, departmentFilter, status, occupancy, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  function openCreate() {
    setEditingPosition(null);
    setFormOpen(true);
  }

  function openEdit(position: Position) {
    setEditingPosition(position);
    setFormOpen(true);
  }

  function openMove(position: Position) {
    setMovingPosition(position);
    setMoveDialogOpen(true);
  }

  function openStatusChange(position: Position) {
    setStatusTarget(position);
    setStatusError(null);
    statusDialog.setOpen(true);
  }

  async function confirmStatusChange() {
    if (!statusTarget) return;
    setStatusPending(true);
    setStatusError(null);
    const action =
      statusTarget.status === "INACTIVE" ? activatePositionAction : archivePositionAction;
    const result = await action({ positionId: statusTarget.id });
    setStatusPending(false);
    if (!result.ok) {
      setStatusError(result.error);
      return;
    }
    statusDialog.setOpen(false);
    refresh();
  }

  function openDelete(position: Position) {
    setDeleteTarget(position);
    setDeleteError(null);
    deleteDialog.setOpen(true);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeletePending(true);
    setDeleteError(null);
    const result = await deletePositionAction({ positionId: deleteTarget.id });
    setDeletePending(false);
    if (!result.ok) {
      // The server names the blocker ("3 positions reporting to it",
      // "has employment history") — shown verbatim, not replaced.
      setDeleteError(result.error);
      return;
    }
    deleteDialog.setOpen(false);
    if (positions.length === 1 && page > 1) setPage(page - 1);
    else refresh();
  }

  function departmentName(departmentId: string): string {
    return departments.find((d) => d.id === departmentId)?.name ?? "—";
  }

  function jobFamilyName(jobFamilyId: string | null): string {
    if (!jobFamilyId) return "—";
    return jobFamilies.find((f) => f.id === jobFamilyId)?.name ?? "—";
  }

  // Family id → name, for the Change Reports-To picker's option lines.
  const jobFamilyNameById = new Map(jobFamilies.map((f) => [f.id, f.name]));

  function jobGradeCode(jobGradeId: string | null): string {
    if (!jobGradeId) return "—";
    return jobGrades.find((g) => g.id === jobGradeId)?.code ?? "—";
  }

  function reportsToTitle(position: Position): string {
    if (!position.primaryReportsToPositionId) return "— (root)";
    return (
      allPositions.find((p) => p.id === position.primaryReportsToPositionId)?.title ?? "Unknown"
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="position-search" className="text-foreground text-sm font-medium">
              Search
            </label>
            <Input
              id="position-search"
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
              placeholder="Search by title or code…"
              className="sm:w-64"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="position-department-filter"
              className="text-foreground text-sm font-medium"
            >
              Department
            </label>
            <Select
              id="position-department-filter"
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
          <div className="flex flex-col gap-1.5">
            <label htmlFor="position-status-filter" className="text-foreground text-sm font-medium">
              Status
            </label>
            <Select
              id="position-status-filter"
              value={status}
              onChange={(event) => {
                setPage(1);
                setStatus(event.target.value as StatusFilter);
              }}
              className="sm:w-40"
            >
              <option value="ALL">All statuses</option>
              <option value="PLANNED">Planned</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="position-occupancy-filter"
              className="text-foreground text-sm font-medium"
            >
              Occupancy
            </label>
            <Select
              id="position-occupancy-filter"
              value={occupancy}
              onChange={(event) => {
                setPage(1);
                setOccupancy(event.target.value as OccupancyFilter);
              }}
              className="sm:w-40"
            >
              <option value="ALL">All occupancy</option>
              <option value="occupied">Occupied</option>
              <option value="vacant">Vacant</option>
            </Select>
          </div>
        </div>
        {canManage ? (
          <Button type="button" onClick={openCreate}>
            <Plus aria-hidden="true" className="size-4" />
            Add Position
          </Button>
        ) : null}
      </div>

      {loading ? (
        <LoadingState label="Loading positions…" />
      ) : error ? (
        <ErrorState description={error} onRetry={refresh} />
      ) : positions.length === 0 ? (
        <EmptyState
          title={
            search || departmentFilter || status !== "ALL"
              ? "No matching positions"
              : "No positions yet"
          }
          description={
            search || departmentFilter || status !== "ALL"
              ? "Try a different search term or filter."
              : canManage
                ? "Create the root position to get started."
                : "No positions have been created yet."
          }
        />
      ) : (
        <div className="border-border overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <caption className="sr-only">Positions</caption>
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Title
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Code
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Department
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Job Family
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Reports to
                </th>
                <th
                  scope="col"
                  className="px-4 py-2 text-left font-medium"
                  title="Career grade (L2–L18)"
                >
                  Grade
                </th>
                <th
                  scope="col"
                  className="px-4 py-2 text-left font-medium"
                  title="Depth in the reporting tree (root = 1)"
                >
                  Depth
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Occupancy
                </th>
                {canManage ? (
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Actions
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {positions.map((position) => (
                <tr key={position.id}>
                  <td className="px-4 py-2 font-medium">{position.title}</td>
                  <td className="px-4 py-2">{position.positionCode}</td>
                  <td className="px-4 py-2">{departmentName(position.departmentId)}</td>
                  <td className="px-4 py-2">{jobFamilyName(position.jobFamilyId)}</td>
                  <td className="px-4 py-2">{reportsToTitle(position)}</td>
                  <td className="px-4 py-2">{jobGradeCode(position.jobGradeId)}</td>
                  <td className="px-4 py-2">{position.organizationalLevel}</td>
                  <td className="px-4 py-2">
                    <Badge variant={STATUS_BADGE_VARIANT[position.status]}>
                      {position.status === "ACTIVE"
                        ? "Active"
                        : position.status === "PLANNED"
                          ? "Planned"
                          : "Inactive"}
                    </Badge>
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={occupiedIds.has(position.id) ? "success" : "outline"}>
                      {occupiedIds.has(position.id) ? "Filled" : "Vacant"}
                    </Badge>
                  </td>
                  {canManage ? (
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(position)}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openMove(position)}
                        >
                          Change Reports-To
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openStatusChange(position)}
                        >
                          {position.status === "INACTIVE" ? "Reactivate" : "Deactivate"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => openDelete(position)}
                        >
                          Delete
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

      {!loading && !error && positions.length > 0 ? (
        <Pagination
          page={page}
          pageSize={DEFAULT_PAGE_SIZE}
          totalCount={totalCount}
          onPageChange={setPage}
        />
      ) : null}

      {canManage ? (
        <>
          <PositionFormDialog
            open={formOpen}
            onOpenChange={setFormOpen}
            position={editingPosition}
            departments={departments}
            jobGrades={jobGrades}
            jobFamilies={jobFamilies}
            careerTracks={careerTracks}
            levelMappingEntries={levelMappingEntries}
            allPositions={allPositions}
            onSaved={refresh}
          />
          <PositionMoveDialog
            open={moveDialogOpen}
            onOpenChange={setMoveDialogOpen}
            position={movingPosition}
            allPositions={allPositions}
            jobFamilyNameById={jobFamilyNameById}
            onMoved={refresh}
          />
        </>
      ) : null}

      {statusTarget ? (
        <ConfirmDialog
          open={statusDialog.open}
          onOpenChange={statusDialog.setOpen}
          title={
            statusTarget.status === "INACTIVE" ? "Reactivate position?" : "Deactivate position?"
          }
          description={
            statusTarget.status === "INACTIVE"
              ? `${statusTarget.title} will become active again.`
              : `${statusTarget.title} will no longer appear as an active position. Its place in the reporting hierarchy and any existing employee assignment are unaffected.`
          }
          confirmLabel={statusTarget.status === "INACTIVE" ? "Reactivate" : "Deactivate"}
          destructive={statusTarget.status !== "INACTIVE"}
          pending={statusPending}
          errorMessage={statusError}
          onConfirm={confirmStatusChange}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          open={deleteDialog.open}
          onOpenChange={deleteDialog.setOpen}
          title="Delete position?"
          description={`${deleteTarget.title} (${deleteTarget.positionCode}) will be permanently removed. This cannot be undone. A position can only be deleted while nothing reports to it and no one is or was assigned to it — otherwise deactivate it instead.`}
          confirmLabel="Delete"
          destructive
          pending={deletePending}
          errorMessage={deleteError}
          onConfirm={confirmDelete}
        />
      ) : null}
    </div>
  );
}
