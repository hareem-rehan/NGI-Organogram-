"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Download, Plus } from "lucide-react";
import type {
  CareerTrack,
  Department,
  JobFamily,
  JobGrade,
  LevelMappingEntry,
  Position,
} from "@prisma/client";

import { Button } from "@/components/ui/button";
import { ConfirmDialog, useConfirmDialog } from "@/components/patterns/confirm-dialog";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingState } from "@/components/patterns/loading-state";
import { getOrganogramAction } from "@/app/(app)/organogram/actions";
import { PositionFormDialog } from "@/app/(app)/positions/_components/position-form-dialog";
import {
  deletePositionAction,
  deletePositionSubtreeAction,
  getSubtreeSizeAction,
  listAllPositionsAction,
  listDepartmentOptionsAction,
  listJobGradeOptionsAction,
  listPositionCareerOptionsAction,
  movePositionAction,
} from "@/app/(app)/positions/actions";
import { OrganogramCanvas } from "@/app/(app)/organogram/_components/organogram-canvas";
import { OrganogramDetailsPanel } from "@/app/(app)/organogram/_components/organogram-details-panel";
import { OrganogramExportDialog } from "@/app/(app)/organogram/_components/organogram-export-dialog";
import { OrganogramFilterDrawer } from "@/app/(app)/organogram/_components/organogram-filter-drawer";
import { OrganogramFocusBar } from "@/app/(app)/organogram/_components/organogram-focus-bar";
import { OrganogramOutlineView } from "@/app/(app)/organogram/_components/organogram-outline-view";
import { OrganogramSearchBox } from "@/app/(app)/organogram/_components/organogram-search-box";
import {
  OrganogramToolbar,
  type OrganogramViewMode,
} from "@/app/(app)/organogram/_components/organogram-toolbar";
import type {
  OrganogramColorMode,
  PositionNodeMatchState,
} from "@/app/(app)/organogram/_components/position-node";
import { buildFamilyColorMap } from "@/lib/domain/organogram-family-colors";
import {
  computeVisiblePositionIds,
  countHiddenDescendants,
  type OrganogramNode,
} from "@/lib/domain/organogram";
import { isBelowThreshold } from "@/lib/domain/organogram-leadership";
import { computeFilterMatchIds, isAnyFilterActive } from "@/lib/domain/organogram-filters";
import {
  buildDepartmentFocusVisibleSet,
  buildFilteredVisibleSet,
  buildPositionFocusVisibleSet,
  type DescendantDepth,
  type VisibleSetResult,
} from "@/lib/domain/organogram-focus";
import {
  defaultOrganogramUrlState,
  parseOrganogramUrlState,
  serializeOrganogramUrlState,
  type OrganogramUrlState,
} from "@/lib/domain/organogram-url-state";
import type { OrganogramChartData } from "@/lib/services/organogram.service";

interface OrganogramViewProps {
  canManage: boolean;
  canViewEmployeeDetails: boolean;
  canExport: boolean;
}

/**
 * Default depth: show the top three display tiers and collapse anything
 * with children below them. With the leadership view's department tier in
 * place that reads as Founder → Departments → each department's
 * leadership, which is exactly the shape the Demo 1 feedback asked for;
 * without it (a raw, unprojected graph — every existing test fixture)
 * it collapses at tier 2 exactly as it always did.
 *
 * Only meaningful in Full Company View; Position/Department Focus always
 * start fully expanded within their own (already-bounded) subgraph.
 */
function defaultCollapsedIds(data: OrganogramChartData): Set<string> {
  const minGrade = data.leadership.minGradeLevel;
  const below = (n: OrganogramNode) => isBelowThreshold(n, minGrade);

  // The chart opens at leadership level and drills down from there: fold
  // away anything below the threshold, and fold any box whose children
  // are ALL below it, so that box still offers an expand control rather
  // than claiming it has no reports. Expanding walks down one rung at a
  // time, because each rung below is itself collapsed.
  const childrenByParent = new Map<string, OrganogramNode[]>();
  for (const node of data.nodes) {
    if (!node.primaryReportsToPositionId) continue;
    const list = childrenByParent.get(node.primaryReportsToPositionId) ?? [];
    list.push(node);
    childrenByParent.set(node.primaryReportsToPositionId, list);
  }

  const collapsed = new Set<string>();
  for (const node of data.nodes) {
    const children = childrenByParent.get(node.positionId) ?? [];
    if (children.length === 0) continue;
    if (below(node) || children.every(below)) collapsed.add(node.positionId);
  }
  return collapsed;
}

function allCollapsibleIds(data: OrganogramChartData): Set<string> {
  return new Set(data.nodes.filter((n) => n.hasChildren).map((n) => n.positionId));
}

export function OrganogramView({
  canManage,
  canViewEmployeeDetails,
  canExport,
}: OrganogramViewProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [data, setData] = useState<OrganogramChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [layoutFailed, setLayoutFailed] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  // URL is the single source of truth for view/focus/filter state (Step
  // 11 "avoid contradictory duplicated state") — derived via useMemo,
  // never copied into a parallel useState, so there is no possible
  // desync and no update-loop to guard against: Back/Forward navigation
  // changes `searchParams`, which changes `urlState`, which flows
  // straight through every computed value below.
  const urlState = useMemo(() => parseOrganogramUrlState(searchParams), [searchParams]);

  // Local-only UI state — deliberately NOT URL-backed (Step 11.3: search
  // query text does not need to persist in the URL; collapse/selection
  // are ephemeral view state, not part of the shareable contract).
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fitViewSignal, setFitViewSignal] = useState(0);
  const [centerOnNodeId, setCenterOnNodeId] = useState<string | null>(null);
  // Ephemeral view state (not part of the shareable URL contract). Cards
  // colour by department by default; "family" switches to the job-family
  // palette.
  const [colorMode, setColorMode] = useState<OrganogramColorMode>("department");

  // Arrange mode (managers only, off by default — docs/DECISIONS.md D21).
  const [arrangeMode, setArrangeMode] = useState(false);

  // Form-option data for the in-chart Add/Edit Position dialog — loaded lazily
  // the first time a manager needs it (entering arrange mode), then refreshed
  // after each mutation so the pickers and the edit target stay current.
  interface PositionFormOptions {
    departments: Department[];
    jobGrades: JobGrade[];
    jobFamilies: JobFamily[];
    careerTracks: CareerTrack[];
    levelMappingEntries: LevelMappingEntry[];
    allPositions: Position[];
  }
  const [formOptions, setFormOptions] = useState<PositionFormOptions | null>(null);

  // Add/Edit Position dialog state.
  const [formOpen, setFormOpen] = useState(false);
  const [formEditPosition, setFormEditPosition] = useState<Position | null>(null);
  const [formInitialDepartmentId, setFormInitialDepartmentId] = useState<string | null>(null);
  const [formInitialReportsToId, setFormInitialReportsToId] = useState<string | null>(null);

  // Re-parent (drag-drop) confirmation.
  interface MoveIntent {
    childId: string;
    parentId: string;
    childTitle: string;
    parentTitle: string;
    affectedCount: number;
  }
  const [moveIntent, setMoveIntent] = useState<MoveIntent | null>(null);
  const moveDialog = useConfirmDialog();
  const [movePending, setMovePending] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  // Delete-card confirmation (single position, or whole subtree).
  interface DeleteIntent {
    positionId: string;
    title: string;
    descendantCount: number;
  }
  const [deleteIntent, setDeleteIntent] = useState<DeleteIntent | null>(null);
  const deleteDialog = useConfirmDialog();
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Shallow-routing via the native History API — NOT `router.push`/
  // `router.replace`, which re-invoke the server component tree (a real
  // DB round-trip through requirePagePermission/requireActiveUser) on
  // every call, since App Router treats every navigation, including a
  // searchParams-only change, as needing a fresh RSC payload. Nothing
  // server-side reads these params at all (only this client component's
  // own useSearchParams() does), so that round-trip is pure waste — and
  // under real load it was slow enough to make rapid filter clicks in
  // e2e/organogram-search-and-focus.spec.ts flake. `window.history.
  // pushState`/`replaceState` integrate directly with Next's router and
  // keep `useSearchParams()`/`usePathname()` in sync with zero server
  // involvement — the officially documented pattern for exactly this
  // (see Next's "Shallow routing on the client" App Router guide).
  const updateUrl = useCallback(
    (patch: Partial<OrganogramUrlState>, options: { push?: boolean } = {}) => {
      const next: OrganogramUrlState = { ...urlState, ...patch };
      const qs = serializeOrganogramUrlState(next).toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      if (options.push) window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    [urlState, pathname]
  );

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    setLayoutFailed(false);
    void (async () => {
      const result = await getOrganogramAction();
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setData(result.data);
      setSelectedId(null);
    })();
  }, []);

  // Load (or reload) the Add/Edit Position form's option data. Managers only;
  // the four reads each re-authorize server-side. Returns the loaded options
  // so callers can act on fresh data (e.g. find an edit target) without
  // waiting for a state round-trip.
  const loadFormOptions = useCallback(async (): Promise<PositionFormOptions | null> => {
    if (!canManage) return null;
    const [departments, jobGrades, career, allPositions] = await Promise.all([
      listDepartmentOptionsAction(),
      listJobGradeOptionsAction(),
      listPositionCareerOptionsAction(),
      listAllPositionsAction(),
    ]);
    if (!departments.ok || !jobGrades.ok || !career.ok || !allPositions.ok) return null;
    const options: PositionFormOptions = {
      departments: departments.data,
      jobGrades: jobGrades.data,
      jobFamilies: career.data.jobFamilies,
      careerTracks: career.data.careerTracks,
      levelMappingEntries: career.data.levelMappingEntries,
      allPositions: allPositions.data,
    };
    setFormOptions(options);
    return options;
  }, [canManage]);

  const handleArrangeModeChange = useCallback(
    (value: boolean) => {
      setArrangeMode(value);
      // Load the form data on first entry so Add/Edit open instantly later.
      if (value && !formOptions) void loadFormOptions();
    },
    [formOptions, loadFormOptions]
  );

  // Reload both the chart and the form options after a structural change, so
  // the pickers, the edit targets and the drawn tree all reflect the new state.
  const refreshAfterMutation = useCallback(() => {
    refresh();
    void loadFormOptions();
  }, [refresh, loadFormOptions]);

  const handleEditCard = useCallback(
    (positionId: string) => {
      // The full Position (with description/code the node doesn't carry) comes
      // from the loaded list; open the form once we have it.
      void (async () => {
        const options = formOptions ?? (await loadFormOptions());
        const target = options?.allPositions.find((p) => p.id === positionId) ?? null;
        if (!target) return;
        setFormEditPosition(target);
        setFormInitialDepartmentId(null);
        setFormInitialReportsToId(null);
        setFormOpen(true);
      })();
    },
    [formOptions, loadFormOptions]
  );

  const handleAddChild = useCallback(
    (parentId: string) => {
      const parent = data?.nodes.find((n) => n.positionId === parentId);
      if (!parent) return;
      if (!formOptions) void loadFormOptions();
      setFormEditPosition(null);
      setFormInitialDepartmentId(parent.departmentId);
      setFormInitialReportsToId(parentId);
      setFormOpen(true);
    },
    [data, formOptions, loadFormOptions]
  );

  const handleReparent = useCallback(
    (childId: string, parentId: string) => {
      const child = data?.nodes.find((n) => n.positionId === childId);
      const parent = data?.nodes.find((n) => n.positionId === parentId);
      if (!child || !parent) return;
      setMoveError(null);
      void (async () => {
        // Affected count = the descendants that get their level recalculated
        // with the move. Best-effort; a failed count just shows none.
        const size = await getSubtreeSizeAction(childId);
        setMoveIntent({
          childId,
          parentId,
          childTitle: child.title,
          parentTitle: parent.title,
          affectedCount: size.ok ? size.data : 0,
        });
        moveDialog.setOpen(true);
      })();
    },
    [data, moveDialog]
  );

  const confirmMove = useCallback(() => {
    if (!moveIntent) return;
    setMovePending(true);
    setMoveError(null);
    void (async () => {
      const result = await movePositionAction({
        positionId: moveIntent.childId,
        newParentPositionId: moveIntent.parentId,
      });
      setMovePending(false);
      if (!result.ok) {
        setMoveError(result.error);
        return;
      }
      moveDialog.setOpen(false);
      setMoveIntent(null);
      refreshAfterMutation();
    })();
  }, [moveIntent, moveDialog, refreshAfterMutation]);

  const handleRequestDelete = useCallback(
    (positionId: string) => {
      const node = data?.nodes.find((n) => n.positionId === positionId);
      if (!node) return;
      setDeleteError(null);
      void (async () => {
        // A node with real direct reports deletes its whole subtree; fetch the
        // descendant count so the confirmation states the blast radius.
        const hasChildren = node.directReportCount > 0;
        const size = hasChildren ? await getSubtreeSizeAction(positionId) : null;
        setDeleteIntent({
          positionId,
          title: node.title,
          descendantCount: size && size.ok ? size.data : 0,
        });
        deleteDialog.setOpen(true);
      })();
    },
    [data, deleteDialog]
  );

  const confirmDelete = useCallback(() => {
    if (!deleteIntent) return;
    setDeletePending(true);
    setDeleteError(null);
    void (async () => {
      const result =
        deleteIntent.descendantCount > 0
          ? await deletePositionSubtreeAction({ positionId: deleteIntent.positionId })
          : await deletePositionAction({ positionId: deleteIntent.positionId });
      setDeletePending(false);
      if (!result.ok) {
        setDeleteError(result.error);
        return;
      }
      deleteDialog.setOpen(false);
      setDeleteIntent(null);
      refreshAfterMutation();
    })();
  }, [deleteIntent, deleteDialog, refreshAfterMutation]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  // Reset collapse state whenever data (re)loads or the focus target
  // changes — Full Company View gets Phase 8's default depth; a Focus
  // view always starts fully expanded within its own already-bounded
  // subgraph (Step 8.8's "focused descendant expansion remains usable"
  // still applies afterward — the user can re-collapse from there).
  useEffect(() => {
    if (!data) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsedIds(urlState.view === "full" ? defaultCollapsedIds(data) : new Set());
  }, [data, urlState.view, urlState.positionId, urlState.departmentId]);

  /**
   * The real Positions only — the leadership view also puts synthetic
   * department headings in `data.nodes`, and every control that is ABOUT
   * a position (search, filters, export scope pickers) must not offer one
   * of those: there is no Position behind it to focus, export or filter
   * on. They still reach the chart itself, which is the one place they
   * mean something.
   */
  const positionNodes = useMemo(
    () => (data ? data.nodes.filter((n) => (n.kind ?? "position") === "position") : []),
    [data]
  );

  const filterMatchIds = useMemo(
    () => computeFilterMatchIds(positionNodes, urlState.filters),
    [positionNodes, urlState.filters]
  );

  const filtersActive = isAnyFilterActive(urlState.filters);

  /** The active search/filter/focus visible-set — null means "no restriction, render exactly like Phase 8." */
  const activeVisibleSet: VisibleSetResult | null = useMemo(() => {
    if (!data) return null;
    if (urlState.view === "position" && urlState.positionId) {
      return buildPositionFocusVisibleSet(data.nodes, urlState.positionId, urlState.depth);
    }
    if (urlState.view === "department" && urlState.departmentId) {
      return buildDepartmentFocusVisibleSet(data.nodes, urlState.departmentId);
    }
    if (urlState.view === "full" && filtersActive) {
      return buildFilteredVisibleSet(data.nodes, filterMatchIds);
    }
    return null;
  }, [
    data,
    urlState.view,
    urlState.positionId,
    urlState.departmentId,
    urlState.depth,
    filtersActive,
    filterMatchIds,
  ]);

  /** A Focus deep-link whose target doesn't resolve to any node — Step 10.13/15's "invalid deep link shows a controlled state." Distinct from "filters matched nothing" (activeVisibleSet still exists there, just empty of matches). */
  const focusTargetMissing =
    (urlState.view === "position" || urlState.view === "department") &&
    activeVisibleSet !== null &&
    activeVisibleSet.matchIds.size === 0;

  const restrictToIds = activeVisibleSet?.visibleIds;

  const matchStateById = useMemo(() => {
    const map = new Map<string, PositionNodeMatchState>();
    if (activeVisibleSet) {
      for (const id of activeVisibleSet.matchIds) map.set(id, "match");
      for (const id of activeVisibleSet.contextIds) map.set(id, "context");
    }
    return map;
  }, [activeVisibleSet]);

  const visibleIds = useMemo(() => {
    if (!data) return new Set<string>();
    return computeVisiblePositionIds({
      allNodes: data.nodes,
      collapsedIds,
      showPlanned: urlState.planned,
      restrictToIds,
    });
  }, [data, collapsedIds, urlState.planned, restrictToIds]);

  const visibleNodes = useMemo(
    () => (data ? data.nodes.filter((n) => visibleIds.has(n.positionId)) : []),
    [data, visibleIds]
  );
  const visibleEdges = useMemo(
    () =>
      data
        ? data.edges.filter(
            (e) => visibleIds.has(e.sourcePositionId) && visibleIds.has(e.targetPositionId)
          )
        : [],
    [data, visibleIds]
  );
  const hiddenDescendantCounts = useMemo(() => {
    if (!data) return new Map<string, number>();
    const counts = new Map<string, number>();
    for (const id of collapsedIds) counts.set(id, countHiddenDescendants(id, data.nodes));
    return counts;
  }, [data, collapsedIds]);

  // Every department present on the chart, ordered by name so palette colour
  // assignment is stable — the same reference palette the sub-division
  // colouring uses, so cards read with the exact reference colours in both
  // modes.
  const departmentsInOrder = useMemo(() => {
    if (!data) return [] as { id: string; name: string }[];
    const seen = new Map<string, string>();
    for (const node of data.nodes) {
      if (!seen.has(node.departmentId)) seen.set(node.departmentId, node.departmentName);
    }
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  const departmentColorById = useMemo(
    () => buildFamilyColorMap(departmentsInOrder.map((d) => d.id)),
    [departmentsInOrder]
  );

  const departmentLegendEntries = useMemo(
    () =>
      departmentsInOrder.map((d) => ({
        id: d.id,
        name: d.name,
        color: departmentColorById.get(d.id)?.accent ?? null,
      })),
    [departmentsInOrder, departmentColorById]
  );

  // Every sub-division present on the chart, ordered by name so colour
  // assignment is stable and reproducible, then mapped to the palette.
  const familiesInOrder = useMemo(() => {
    if (!data) return [] as { id: string; name: string }[];
    const seen = new Map<string, string>();
    for (const node of data.nodes) {
      if (node.jobFamilyId && node.jobFamilyName && !seen.has(node.jobFamilyId)) {
        seen.set(node.jobFamilyId, node.jobFamilyName);
      }
    }
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  const familyColorById = useMemo(
    () => buildFamilyColorMap(familiesInOrder.map((f) => f.id)),
    [familiesInOrder]
  );

  const familyLegendEntries = useMemo(
    () =>
      familiesInOrder.map((f) => ({
        id: f.id,
        name: f.name,
        color: familyColorById.get(f.id)?.accent ?? "transparent",
      })),
    [familiesInOrder, familyColorById]
  );

  const selectedNode = useMemo(
    () => (selectedId ? (positionNodes.find((n) => n.positionId === selectedId) ?? null) : null),
    [positionNodes, selectedId]
  );

  const focusLabel = useMemo(() => {
    if (!data) return null;
    if (urlState.view === "position" && urlState.positionId) {
      return data.nodes.find((n) => n.positionId === urlState.positionId)?.title ?? null;
    }
    if (urlState.view === "department" && urlState.departmentId) {
      return (
        data.nodes.find((n) => n.departmentId === urlState.departmentId)?.departmentName ?? null
      );
    }
    return null;
  }, [data, urlState.view, urlState.positionId, urlState.departmentId]);

  const toggleCollapse = useCallback((positionId: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(positionId)) next.delete(positionId);
      else next.add(positionId);
      return next;
    });
  }, []);

  const handleExpandAll = useCallback(() => setCollapsedIds(new Set()), []);
  const handleCollapseAll = useCallback(() => {
    if (data) setCollapsedIds(allCollapsibleIds(data));
  }, [data]);
  const handleFitToView = useCallback(() => {
    setCenterOnNodeId(null);
    setFitViewSignal((n) => n + 1);
  }, []);
  const handleResetView = useCallback(() => {
    if (data) setCollapsedIds(defaultCollapsedIds(data));
    setSelectedId(null);
    setCenterOnNodeId(null);
    setFitViewSignal((n) => n + 1);
    updateUrl(defaultOrganogramUrlState(), { push: true });
  }, [data, updateUrl]);

  const handleSearchSelect = useCallback(
    (positionId: string) => {
      updateUrl(
        { view: "position", positionId, departmentId: null, depth: urlState.depth },
        { push: true }
      );
      setSelectedId(positionId);
      setCenterOnNodeId(positionId);
    },
    [updateUrl, urlState.depth]
  );

  const handleFocusPosition = useCallback(
    (positionId: string) => {
      updateUrl({ view: "position", positionId, departmentId: null }, { push: true });
      setCenterOnNodeId(positionId);
    },
    [updateUrl]
  );

  const handleFocusDepartment = useCallback(
    (departmentId: string) => {
      updateUrl({ view: "department", departmentId, positionId: null }, { push: true });
      setCenterOnNodeId(null);
    },
    [updateUrl]
  );

  const handleReturnToFullView = useCallback(() => {
    updateUrl({ view: "full", positionId: null, departmentId: null }, { push: true });
    setCenterOnNodeId(null);
  }, [updateUrl]);

  const handleDepthChange = useCallback(
    (depth: DescendantDepth) => updateUrl({ depth }, { push: true }),
    [updateUrl]
  );

  const handleFiltersChange = useCallback(
    (filters: OrganogramUrlState["filters"]) => updateUrl({ filters }, { push: false }),
    [updateUrl]
  );

  const handleCopyLink = useCallback(async (): Promise<boolean> => {
    try {
      const qs = serializeOrganogramUrlState(urlState).toString();
      const url = `${window.location.origin}${pathname}${qs ? `?${qs}` : ""}`;
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      return false;
    }
  }, [urlState, pathname]);

  if (loading) return <LoadingState label="Loading organization chart…" />;
  if (error || !data)
    return (
      <ErrorState description={error ?? "Organization chart unavailable."} onRetry={refresh} />
    );

  if (!data.safety.hasRoot) {
    return (
      <section
        role="status"
        className="border-border bg-muted flex flex-col items-start gap-2 rounded-lg border border-dashed p-6"
      >
        <p className="text-foreground text-sm font-medium">No positions yet</p>
        <p className="text-muted-foreground text-sm">
          {canManage
            ? "Create the first position to begin your organization chart."
            : "This company's organization chart has not been set up yet."}
        </p>
        {canManage ? (
          <Button asChild size="sm" className="mt-1">
            <Link href="/positions">
              <Plus aria-hidden="true" className="size-4" />
              Add Position
            </Link>
          </Button>
        ) : null}
      </section>
    );
  }

  const corruptedCount =
    data.safety.cyclePositionCount +
    data.safety.disconnectedPositionCount +
    data.safety.extraRootCount;

  const isFocusMode = urlState.view === "position" || urlState.view === "department";

  return (
    <div className="flex flex-col gap-3">
      {corruptedCount > 0 ? (
        <div
          role="alert"
          className="border-status-planned/40 bg-status-planned/5 flex items-start gap-3 rounded-lg border p-3"
        >
          <AlertTriangle
            aria-hidden="true"
            className="text-status-planned-foreground mt-0.5 size-4 shrink-0"
          />
          <p className="text-foreground text-sm">
            {corruptedCount} position{corruptedCount === 1 ? " has" : "s have"} a data issue (a
            reporting cycle or a disconnected manager) and {corruptedCount === 1 ? "is" : "are"} not
            shown below. No relationship was guessed or repaired automatically.{" "}
            {canManage ? (
              <Link href="/positions" className="underline">
                Review positions
              </Link>
            ) : null}
          </p>
        </div>
      ) : null}

      {layoutFailed ? (
        <div role="alert" className="border-destructive/30 bg-destructive/5 rounded-lg border p-3">
          <p className="text-foreground text-sm">
            The visual chart could not be laid out. Showing the Outline View instead.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <OrganogramSearchBox
          nodes={positionNodes}
          showPlanned={urlState.planned}
          onSelectResult={handleSearchSelect}
        />
        <OrganogramFilterDrawer
          nodes={positionNodes}
          filters={urlState.filters}
          onFiltersChange={handleFiltersChange}
          matchCount={filterMatchIds.size}
        />
        {canExport ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setExportDialogOpen(true)}
          >
            <Download aria-hidden="true" className="size-4" />
            Export
          </Button>
        ) : null}
      </div>

      {isFocusMode ? (
        <OrganogramFocusBar
          view={urlState.view}
          focusLabel={focusLabel}
          depth={urlState.depth}
          onDepthChange={handleDepthChange}
          onReturnToFullView={handleReturnToFullView}
          onCopyLink={handleCopyLink}
        />
      ) : null}

      <OrganogramToolbar
        viewMode={layoutFailed ? "outline" : (urlState.display as OrganogramViewMode)}
        onViewModeChange={(mode) => updateUrl({ display: mode }, { push: true })}
        colorMode={colorMode}
        onColorModeChange={setColorMode}
        showPlanned={urlState.planned}
        onShowPlannedChange={(planned) => updateUrl({ planned }, { push: false })}
        onExpandAll={handleExpandAll}
        onCollapseAll={handleCollapseAll}
        onFitToView={handleFitToView}
        onResetView={handleResetView}
        canManage={canManage}
        arrangeMode={arrangeMode}
        onArrangeModeChange={handleArrangeModeChange}
      />

      {arrangeMode ? (
        <p role="status" className="text-muted-foreground text-xs">
          Arrange mode — drag a card onto another to change who it reports to, use{" "}
          <Plus aria-hidden="true" className="inline size-3.5 align-text-bottom" /> to add a report,
          the trash icon to delete, and click a card to edit it. A drag onto empty space just nudges
          the card; the layout is regenerated on reload.
        </p>
      ) : null}

      {data.leadership.applied &&
      (data.leadership.hidden.total > 0 || data.leadership.collapsedBelowThreshold > 0) ? (
        // Says out loud what the chart is doing. There are two different
        // things to be honest about and they are NOT the same: roles below
        // the threshold are folded away and one click from view, while
        // ungraded ones genuinely are not drawn. Calling both "hidden"
        // would make a missing job grade look like a deliberate filter.
        <p role="status" className="text-muted-foreground text-xs">
          Leadership view — opens at L{data.leadership.minGradeLevel} and above.
          {data.leadership.collapsedBelowThreshold > 0 ? (
            <>
              {" "}
              {data.leadership.collapsedBelowThreshold} more junior role
              {data.leadership.collapsedBelowThreshold === 1 ? " is" : "s are"} folded away — expand
              any box to drill further down.
            </>
          ) : null}
          {data.leadership.hidden.total > 0 ? (
            <>
              {" "}
              {data.leadership.hidden.total} position
              {data.leadership.hidden.total === 1 ? " is" : "s are"} not on the chart (
              {[
                data.leadership.hidden.ungraded > 0
                  ? `${data.leadership.hidden.ungraded} with no level set`
                  : null,
                data.leadership.hidden.vacant > 0
                  ? `${data.leadership.hidden.vacant} vacant`
                  : null,
                data.leadership.hidden.belowGrade > 0
                  ? `${data.leadership.hidden.belowGrade} below L${data.leadership.minGradeLevel}`
                  : null,
                data.leadership.hidden.inactive > 0
                  ? `${data.leadership.hidden.inactive} deactivated`
                  : null,
              ]
                .filter(Boolean)
                .join(", ")}
              ), and unchanged in{" "}
              <Link href="/positions" className="underline">
                Positions
              </Link>
              .
            </>
          ) : null}
        </p>
      ) : null}

      {isFocusMode && focusTargetMissing ? (
        <section
          role="status"
          className="border-border bg-muted flex flex-col items-start gap-2 rounded-lg border border-dashed p-6"
        >
          <p className="text-foreground text-sm font-medium">
            {urlState.view === "position" ? "Position not found" : "Department not found"}
          </p>
          <p className="text-muted-foreground text-sm">
            This link may point to a position or department that no longer exists, has been moved,
            or belongs to a different company.
          </p>
          <Button size="sm" className="mt-1" onClick={handleReturnToFullView}>
            Return to Full Company View
          </Button>
        </section>
      ) : !isFocusMode && filtersActive && filterMatchIds.size === 0 ? (
        <section
          role="status"
          className="border-border bg-muted flex flex-col items-start gap-2 rounded-lg border border-dashed p-6"
        >
          <p className="text-foreground text-sm font-medium">No matching positions</p>
          <p className="text-muted-foreground text-sm">
            No position matches the current filters. Try removing one or more filters.
          </p>
        </section>
      ) : (
        <div className="border-border flex flex-col overflow-hidden rounded-lg border sm:flex-row">
          <div className="relative min-w-0 flex-1">
            {urlState.display === "visual" && !layoutFailed ? (
              <OrganogramCanvas
                visibleNodes={visibleNodes}
                visibleEdges={visibleEdges}
                collapsedIds={collapsedIds}
                hiddenDescendantCounts={hiddenDescendantCounts}
                selectedId={selectedId}
                onToggleCollapse={toggleCollapse}
                onSelect={setSelectedId}
                onLayoutError={() => setLayoutFailed(true)}
                fitViewSignal={fitViewSignal}
                departmentLegendEntries={departmentLegendEntries}
                colorMode={colorMode}
                departmentColorById={departmentColorById}
                familyColorById={familyColorById}
                familyLegendEntries={familyLegendEntries}
                matchStateById={matchStateById}
                centerOnNodeId={centerOnNodeId}
                arrangeMode={arrangeMode}
                onReparent={handleReparent}
                onEditCard={handleEditCard}
                onAddChild={handleAddChild}
                onRequestDelete={handleRequestDelete}
              />
            ) : (
              <div className="max-h-[65vh] overflow-y-auto">
                <OrganogramOutlineView
                  nodes={data.nodes}
                  collapsedIds={collapsedIds}
                  showPlanned={urlState.planned}
                  selectedId={selectedId}
                  visibleIds={restrictToIds}
                  matchStateById={matchStateById}
                  onToggleCollapse={toggleCollapse}
                  onSelect={setSelectedId}
                />
              </div>
            )}
          </div>

          {selectedNode ? (
            <OrganogramDetailsPanel
              node={selectedNode}
              canViewEmployeeDetails={canViewEmployeeDetails}
              onClose={() => setSelectedId(null)}
              onFocusPosition={handleFocusPosition}
              onFocusDepartment={handleFocusDepartment}
            />
          ) : null}
        </div>
      )}

      {canExport ? (
        <OrganogramExportDialog
          open={exportDialogOpen}
          onOpenChange={setExportDialogOpen}
          nodes={positionNodes}
          departmentEntries={departmentLegendEntries}
          currentColorMode={colorMode}
          currentContext={{
            view: urlState.view,
            positionId: urlState.positionId,
            departmentId: urlState.departmentId,
            depth: urlState.depth,
            filters: urlState.filters,
            showPlanned: urlState.planned,
          }}
        />
      ) : null}

      {/* Arrange-mode management dialogs (managers only). Rendered once the
          form option data is loaded; every mutation is still re-authorized and
          re-validated server-side regardless of these client controls. */}
      {canManage && formOptions ? (
        <PositionFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          position={formEditPosition}
          departments={formOptions.departments}
          jobGrades={formOptions.jobGrades}
          jobFamilies={formOptions.jobFamilies}
          careerTracks={formOptions.careerTracks}
          levelMappingEntries={formOptions.levelMappingEntries}
          allPositions={formOptions.allPositions}
          initialDepartmentId={formInitialDepartmentId}
          initialReportsToPositionId={formInitialReportsToId}
          onSaved={refreshAfterMutation}
        />
      ) : null}

      {moveIntent ? (
        <ConfirmDialog
          open={moveDialog.open}
          onOpenChange={(open) => {
            moveDialog.setOpen(open);
            if (!open) setMoveIntent(null);
          }}
          title="Change reporting line?"
          description={`${moveIntent.childTitle} will report to ${moveIntent.parentTitle}.${
            moveIntent.affectedCount > 0
              ? ` ${moveIntent.affectedCount} position${moveIntent.affectedCount === 1 ? "" : "s"} beneath it will have their level recalculated.`
              : ""
          }`}
          confirmLabel="Move"
          pending={movePending}
          errorMessage={moveError}
          onConfirm={confirmMove}
        />
      ) : null}

      {deleteIntent ? (
        <ConfirmDialog
          open={deleteDialog.open}
          onOpenChange={(open) => {
            deleteDialog.setOpen(open);
            if (!open) setDeleteIntent(null);
          }}
          title={deleteIntent.descendantCount > 0 ? "Delete this branch?" : "Delete this position?"}
          description={
            deleteIntent.descendantCount > 0
              ? `${deleteIntent.title} and everything reporting to it — ${deleteIntent.descendantCount + 1} positions in total — will be permanently removed. This cannot be undone, and is only possible if no one in the branch is or was assigned; otherwise deactivate it instead.`
              : `${deleteIntent.title} will be permanently removed. This cannot be undone. A position can only be deleted while no one is or was assigned to it — otherwise deactivate it instead.`
          }
          confirmLabel={deleteIntent.descendantCount > 0 ? "Delete branch" : "Delete"}
          destructive
          pending={deletePending}
          errorMessage={deleteError}
          onConfirm={confirmDelete}
        />
      ) : null}
    </div>
  );
}
