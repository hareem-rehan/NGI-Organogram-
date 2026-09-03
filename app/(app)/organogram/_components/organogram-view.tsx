"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Download, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingState } from "@/components/patterns/loading-state";
import { getOrganogramAction } from "@/app/(app)/organogram/actions";
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
import type { PositionNodeMatchState } from "@/app/(app)/organogram/_components/position-node";
import { computeVisiblePositionIds, countHiddenDescendants } from "@/lib/domain/organogram";
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
import type { OrganogramData } from "@/lib/services/organogram.service";

interface OrganogramViewProps {
  canManage: boolean;
  canViewEmployeeDetails: boolean;
  canExport: boolean;
}

/** Default: root (level 1) and its direct children (level 2) visible — every level-2 node with children starts collapsed. Only meaningful in Full Company View; Position/Department Focus always start fully expanded within their own (already-bounded) subgraph. */
function defaultCollapsedIds(data: OrganogramData): Set<string> {
  return new Set(
    data.nodes.filter((n) => n.organizationalLevel === 2 && n.hasChildren).map((n) => n.positionId)
  );
}

function allCollapsibleIds(data: OrganogramData): Set<string> {
  return new Set(data.nodes.filter((n) => n.hasChildren).map((n) => n.positionId));
}

export function OrganogramView({
  canManage,
  canViewEmployeeDetails,
  canExport,
}: OrganogramViewProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [data, setData] = useState<OrganogramData | null>(null);
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

  const filterMatchIds = useMemo(() => {
    if (!data) return new Set<string>();
    return computeFilterMatchIds(data.nodes, urlState.filters);
  }, [data, urlState.filters]);

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

  const departmentLegendEntries = useMemo(() => {
    if (!data) return [];
    const seen = new Map<string, { id: string; name: string; color: string | null }>();
    for (const node of data.nodes) {
      if (!seen.has(node.departmentId)) {
        seen.set(node.departmentId, {
          id: node.departmentId,
          name: node.departmentName,
          color: node.departmentColor,
        });
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  const selectedNode = useMemo(
    () =>
      data && selectedId ? (data.nodes.find((n) => n.positionId === selectedId) ?? null) : null,
    [data, selectedId]
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
          nodes={data.nodes}
          showPlanned={urlState.planned}
          onSelectResult={handleSearchSelect}
        />
        <OrganogramFilterDrawer
          nodes={data.nodes}
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
        showPlanned={urlState.planned}
        onShowPlannedChange={(planned) => updateUrl({ planned }, { push: false })}
        onExpandAll={handleExpandAll}
        onCollapseAll={handleCollapseAll}
        onFitToView={handleFitToView}
        onResetView={handleResetView}
      />

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
                matchStateById={matchStateById}
                centerOnNodeId={centerOnNodeId}
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
          nodes={data.nodes}
          departmentEntries={departmentLegendEntries}
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
    </div>
  );
}
