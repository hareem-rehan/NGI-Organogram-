"use client";

import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
  type NodeChange,
} from "@xyflow/react";

import {
  computeElkLayout,
  NODE_HEIGHT,
  NODE_WIDTH,
  type LayoutPosition,
} from "@/app/(app)/organogram/_lib/elk-layout";
import { computeLayoutClusters } from "@/lib/domain/organogram-layout-clusters";
import {
  collectDisplayedDescendants,
  judgeDrop,
  type DropVerdict,
} from "@/lib/domain/organogram-drag";
import {
  NODE_TYPES,
  type OrganogramColorMode,
  type PositionNodeData,
  type PositionNodeMatchState,
} from "@/app/(app)/organogram/_components/position-node";
import { EDGE_TYPES } from "@/app/(app)/organogram/_components/org-chart-edge";
import {
  OrganogramLegend,
  type FamilyLegendEntry,
} from "@/app/(app)/organogram/_components/organogram-legend";
import type { OrganogramEdge, OrganogramNode } from "@/lib/domain/organogram";
import type { FamilyColor } from "@/lib/domain/organogram-family-colors";

/** Display tiers framed on first open: root, departments, their leaders. */
const READABLE_OPEN_TIERS = 3;
/**
 * Automatic framing never goes smaller than this. Below it the framing shows
 * the TOP of the chart instead of shrinking the whole company further.
 */
const READABLE_MIN_ZOOM = 0.35;
/** Screen-space margin around the automatically framed area. */
const FRAME_PADDING = 32;

interface DepartmentLegendEntry {
  id: string;
  name: string;
  color: string | null;
}

interface OrganogramCanvasProps {
  visibleNodes: readonly OrganogramNode[];
  visibleEdges: readonly OrganogramEdge[];
  collapsedIds: ReadonlySet<string>;
  hiddenDescendantCounts: ReadonlyMap<string, number>;
  selectedId: string | null;
  onToggleCollapse: (positionId: string) => void;
  onSelect: (positionId: string) => void;
  onLayoutError: () => void;
  /** Bumped by the parent's Reset/Fit toolbar actions to trigger an imperative fitView(). */
  fitViewSignal: number;
  departmentLegendEntries: readonly DepartmentLegendEntry[];
  /** Which dimension colours the cards, and (in family mode) the per-family colours + legend. */
  colorMode: OrganogramColorMode;
  departmentColorById: ReadonlyMap<string, FamilyColor>;
  familyColorById: ReadonlyMap<string, FamilyColor>;
  familyLegendEntries: readonly FamilyLegendEntry[];
  /** Phase 9: Match/Context styling per node — omitted or "none" renders exactly like Phase 8. */
  matchStateById?: ReadonlyMap<string, PositionNodeMatchState>;
  /**
   * Phase 9: when set, the NEXT layout computation centers/zooms on this
   * node instead of fitting the whole visible graph — used when a search
   * result is selected (docs/ORGANOGRAM_SEARCH_AND_FOCUS.md
   * "Search-Result-Selection Behavior"). Read via a ref inside the layout
   * effect (not a dependency) so merely changing this prop never forces
   * an extra ELK re-layout by itself — it only takes effect the next time
   * the visible node/edge SET actually changes, which search-result
   * selection always does (it switches into Position Focus).
   */
  centerOnNodeId?: string | null;
  /**
   * Arrange mode (managers only, off by default — docs/DECISIONS.md D21).
   * When on, real position cards become draggable: dropping one onto another
   * card re-parents it (`onReparent`), while a drop on empty canvas just
   * nudges it visually for this session (never persisted — the layout is
   * always auto-generated per CLAUDE.md §0). Cards also expose Add-report /
   * Delete / Edit via the callbacks below. All four are no-ops when off.
   */
  arrangeMode?: boolean;
  /**
   * A valid drop (lib/domain/organogram-drag.ts): onto a position card (it
   * becomes the new head) or a department heading (the position joins that
   * department under its top position). Its whole branch moves with it.
   */
  onReparent?: (childPositionId: string, verdict: Extract<DropVerdict, { valid: true }>) => void;
  /** A refused drop (onto itself, a subordinate, or a sub-division box), with the reason. */
  onInvalidDrop?: (reason: string) => void;
  onEditCard?: (positionId: string) => void;
  onAddChild?: (positionId: string) => void;
  onRequestDelete?: (positionId: string) => void;
}

function CanvasInner({
  visibleNodes,
  visibleEdges,
  collapsedIds,
  hiddenDescendantCounts,
  selectedId,
  onToggleCollapse,
  onSelect,
  onLayoutError,
  fitViewSignal,
  departmentLegendEntries,
  colorMode,
  departmentColorById,
  familyColorById,
  familyLegendEntries,
  matchStateById,
  centerOnNodeId,
  arrangeMode = false,
  onReparent,
  onInvalidDrop,
  onEditCard,
  onAddChild,
  onRequestDelete,
}: OrganogramCanvasProps) {
  const [positions, setPositions] = useState<Map<string, LayoutPosition>>(new Map());
  // Ephemeral per-session drag offsets in arrange mode — NEVER persisted (the
  // chart layout is always auto-generated, CLAUDE.md §0). Cleared whenever the
  // visible set changes (a re-layout) or arrange mode turns off.
  const [manualPositions, setManualPositions] = useState<Map<string, LayoutPosition>>(new Map());
  const { fitView, setCenter, setViewport, getIntersectingNodes } = useReactFlow();
  // Canvas pane size, for computing the first-open framing directly.
  const paneWidth = useStore((state) => state.width);
  const paneHeight = useStore((state) => state.height);
  const layoutRequestId = useRef(0);
  const centerOnNodeIdRef = useRef(centerOnNodeId);
  useEffect(() => {
    centerOnNodeIdRef.current = centerOnNodeId;
  });

  // The most recent layout still waiting to be framed (see frameReadably).
  const pendingFrameRef = useRef<Map<string, LayoutPosition> | null>(null);

  /**
   * Automatic framing never zooms below a readable size: if the whole chart
   * fits at a readable zoom it is shown whole; otherwise the TOP of the chart
   * (root, departments, their leaders) is framed at that zoom, so cards stay
   * legible without zooming in. The Fit to View button still shows
   * everything at any zoom. Waits until the canvas has been measured.
   */
  const frameReadably = useCallback(() => {
    const computed = pendingFrameRef.current;
    if (!computed || paneWidth <= 0 || paneHeight <= 0) return;
    pendingFrameRef.current = null;
    const all = [...computed.values()];
    if (all.length === 0) return;
    const top = visibleNodes
      .filter((n) => (n.displayDepth ?? n.organizationalLevel) <= READABLE_OPEN_TIERS)
      .map((n) => computed.get(n.positionId))
      .filter((p): p is LayoutPosition => p !== undefined);
    const frame = (boxes: LayoutPosition[]) => {
      const minX = Math.min(...boxes.map((p) => p.x));
      const maxX = Math.max(...boxes.map((p) => p.x + NODE_WIDTH));
      const minY = Math.min(...boxes.map((p) => p.y));
      const maxY = Math.max(...boxes.map((p) => p.y + NODE_HEIGHT));
      const fitZoom = Math.min(
        (paneWidth - 2 * FRAME_PADDING) / (maxX - minX),
        (paneHeight - 2 * FRAME_PADDING) / (maxY - minY)
      );
      return { minX, maxX, minY, fitZoom };
    };
    const whole = frame(all);
    // The whole chart when it fits at a readable zoom; otherwise the top tiers
    // (root, departments, their leaders) as large as they fit.
    const target = whole.fitZoom >= READABLE_MIN_ZOOM || top.length === 0 ? whole : frame(top);
    const zoom = Math.min(1, Math.max(READABLE_MIN_ZOOM, target.fitZoom));
    requestAnimationFrame(() =>
      setViewport(
        {
          x: paneWidth / 2 - ((target.minX + target.maxX) / 2) * zoom,
          y: FRAME_PADDING - target.minY * zoom,
          zoom,
        },
        { duration: 200 }
      )
    );
  }, [paneWidth, paneHeight, visibleNodes, setViewport]);
  const frameReadablyRef = useRef(frameReadably);
  useEffect(() => {
    frameReadablyRef.current = frameReadably;
    // A layout that finished before the canvas was measured is framed now.
    frameReadably();
  }, [frameReadably]);

  const nodeIdsKey = useMemo(() => visibleNodes.map((n) => n.positionId).join(","), [visibleNodes]);
  const edgesKey = useMemo(
    () => visibleEdges.map((e) => `${e.sourcePositionId}>${e.targetPositionId}`).join(","),
    [visibleEdges]
  );

  useEffect(() => {
    const requestId = ++layoutRequestId.current;
    let cancelled = false;

    // Each department's branch is laid out in its own box, side by side, so
    // departments stay visibly separated and a wide branch never drifts under
    // a neighbour (lib/domain/organogram-layout-clusters.ts).
    void computeElkLayout(
      visibleNodes.map((n) => n.positionId),
      visibleEdges,
      computeLayoutClusters(visibleNodes)
    )
      .then((computed) => {
        if (cancelled || requestId !== layoutRequestId.current) return;
        setPositions(computed);
        const centerId = centerOnNodeIdRef.current;
        const centerPos = centerId ? computed.get(centerId) : undefined;
        requestAnimationFrame(() => {
          if (centerPos) {
            setCenter(centerPos.x + NODE_WIDTH / 2, centerPos.y + NODE_HEIGHT / 2, {
              zoom: 1,
              duration: 300,
            });
          } else {
            // Framed once the canvas has a size (it may not be measured yet
            // on the very first layout) — see `frameReadably`.
            pendingFrameRef.current = computed;
            frameReadablyRef.current();
          }
        });
      })
      .catch(() => {
        if (!cancelled) onLayoutError();
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeIdsKey, edgesKey]);

  // A re-layout (visible set changed) or leaving arrange mode discards any
  // transient drag offsets, so the auto-generated layout always reasserts.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setManualPositions((current) => (current.size === 0 ? current : new Map()));
  }, [nodeIdsKey, edgesKey, arrangeMode]);

  // Drag bookkeeping (arrange mode only). Position changes stream in during a
  // drag; we mirror them into `manualPositions` so the card follows the cursor
  // and stays put on release (a free move). Re-parenting is decided on drop.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (!arrangeMode) return;
      setManualPositions((current) => {
        let next = current;
        for (const change of changes) {
          if (change.type === "position" && change.position) {
            if (next === current) next = new Map(current);
            next.set(change.id, change.position);
          }
        }
        return next;
      });
    },
    [arrangeMode]
  );

  // Everything drawn below the card being dragged, captured at drag start, so
  // hovering and dropping can refuse its own subordinates instantly.
  const dragDescendantsRef = useRef<Set<string>>(new Set());
  // Live drop feedback: which card is under the dragged one, and whether
  // dropping there is allowed (green ring) or not (red ring).
  const [dropHint, setDropHint] = useState<{ targetId: string; valid: boolean } | null>(null);

  const nodeById = useMemo(
    () => new Map(visibleNodes.map((n) => [n.positionId, n])),
    [visibleNodes]
  );

  const judgeDropFor = useCallback(
    (dragged: Node): { targetId: string; verdict: DropVerdict } | null => {
      // The card the dragged one overlaps MOST — not whichever happens to be
      // listed first — so a drop lands where the user is actually pointing.
      const dx = dragged.position.x;
      const dy = dragged.position.y;
      const overlap = (other: Node) =>
        Math.max(0, Math.min(dx, other.position.x) + NODE_WIDTH - Math.max(dx, other.position.x)) *
        Math.max(0, Math.min(dy, other.position.y) + NODE_HEIGHT - Math.max(dy, other.position.y));
      const target = getIntersectingNodes(dragged)
        .filter((other) => other.id !== dragged.id)
        .sort((a, b) => overlap(b) - overlap(a))[0];
      const targetNode = target ? nodeById.get(target.id) : undefined;
      if (!target || !targetNode) return null;
      return {
        targetId: target.id,
        verdict: judgeDrop(dragged.id, targetNode, dragDescendantsRef.current),
      };
    },
    [getIntersectingNodes, nodeById]
  );

  const onNodeDragStart = useCallback(
    (_event: unknown, node: Node) => {
      dragDescendantsRef.current = collectDisplayedDescendants(node.id, visibleEdges);
    },
    [visibleEdges]
  );

  const onNodeDrag = useCallback(
    (_event: unknown, node: Node) => {
      const judged = judgeDropFor(node);
      const next = judged ? { targetId: judged.targetId, valid: judged.verdict.valid } : null;
      setDropHint((current) =>
        current?.targetId === next?.targetId && current?.valid === next?.valid ? current : next
      );
    },
    [judgeDropFor]
  );

  const onNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      setDropHint(null);
      if (!arrangeMode || !onReparent) return;
      // A drop ONTO a card re-parents (a position) or moves into a department
      // (a department heading); a drop on empty canvas is left as a visual
      // nudge. Refused drops say why and snap back.
      const judged = judgeDropFor(node);
      if (!judged) return;
      if (judged.verdict.valid) onReparent(node.id, judged.verdict);
      else onInvalidDrop?.(judged.verdict.reason);
      // Snap the dragged card back to the computed layout — the move either
      // succeeds (a re-layout follows) or is declined/blocked (it belongs
      // where the layout put it), so a half-dropped card should never linger.
      setManualPositions((current) => {
        if (!current.has(node.id)) return current;
        const next = new Map(current);
        next.delete(node.id);
        return next;
      });
    },
    [arrangeMode, onReparent, onInvalidDrop, judgeDropFor]
  );

  // The card colour for a node in the active mode: a department heading, or
  // any card in department mode, takes its department's palette colour; a
  // position in sub-division mode takes its sub-division's palette colour
  // (null when unclassified, leaving a neutral card).
  const resolveCardColor = useCallback(
    (node: OrganogramNode): FamilyColor | null => {
      // "Colour by: Sub-division" (docs/DECISIONS.md D29): ONLY sub-divisions
      // carry colour — each sub-division box and every card in that
      // sub-division take the sub-division's colour; department headings and
      // cards outside any sub-division stay neutral, so the view reads as a
      // map of sub-divisions rather than of departments.
      if (colorMode === "family") {
        if (node.kind === "department") return null;
        return node.jobFamilyId ? (familyColorById.get(node.jobFamilyId) ?? null) : null;
      }
      // Department mode: a sub-division box takes its parent department's
      // colour, so a department and its sub-divisions read as one group.
      return departmentColorById.get(node.departmentId) ?? null;
    },
    [colorMode, departmentColorById, familyColorById]
  );

  // Positions only change when the visible id/edge SET changes (the
  // effect above); selection/collapse state is derived here on every
  // render instead of a second effect, so toggling a node never re-runs
  // ELK and never needs to synchronize two pieces of state.
  const flowNodes = useMemo<Node<PositionNodeData>[]>(
    () =>
      visibleNodes
        .filter((node) => positions.has(node.positionId))
        .map((node) => {
          // Only real positions drag, and never the root (it has no manager —
          // re-parenting it would leave the company with no root at all).
          // Synthetic grouping cards (department, sub-division) never drag.
          const isRealPosition = (node.kind ?? "position") === "position";
          const isRoot = node.primaryReportsToPositionId === null;
          return {
            id: node.positionId,
            type: "positionNode",
            position: manualPositions.get(node.positionId) ?? positions.get(node.positionId)!,
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
            draggable: arrangeMode && isRealPosition && !isRoot,
            data: {
              node,
              isCollapsed: collapsedIds.has(node.positionId),
              hiddenDescendantCount: hiddenDescendantCounts.get(node.positionId) ?? 0,
              isSelected: selectedId === node.positionId,
              matchState: matchStateById?.get(node.positionId) ?? "none",
              cardColor: resolveCardColor(node),
              onToggleCollapse,
              onSelect,
              arrangeMode,
              onEdit: onEditCard,
              onAddChild,
              // The root is never deletable from here — deleting it would take
              // the whole company with it. `undefined` hides the control.
              onRequestDelete: isRoot ? undefined : onRequestDelete,
              dropHint:
                dropHint?.targetId === node.positionId
                  ? dropHint.valid
                    ? "valid"
                    : "invalid"
                  : undefined,
            } satisfies PositionNodeData,
          };
        }),
    [
      visibleNodes,
      positions,
      manualPositions,
      collapsedIds,
      hiddenDescendantCounts,
      selectedId,
      matchStateById,
      resolveCardColor,
      onToggleCollapse,
      onSelect,
      arrangeMode,
      onEditCard,
      onAddChild,
      onRequestDelete,
      dropHint,
    ]
  );

  const shownDepartmentCount = useMemo(
    () => visibleNodes.filter((n) => n.kind === "department").length,
    [visibleNodes]
  );
  // Real positions only — synthetic grouping cards (department, sub-division)
  // are counted apart so the tally never overstates how many roles are shown.
  const shownPositionCount = useMemo(
    () => visibleNodes.filter((n) => (n.kind ?? "position") === "position").length,
    [visibleNodes]
  );

  const flowEdges = useMemo<Edge[]>(
    () =>
      visibleEdges
        .filter(
          (edge) => positions.has(edge.sourcePositionId) && positions.has(edge.targetPositionId)
        )
        .map((edge) => ({
          id: `${edge.sourcePositionId}-${edge.targetPositionId}`,
          source: edge.sourcePositionId,
          target: edge.targetPositionId,
          // Org-chart connector: one shared bar per parent (D31).
          type: "org",
        })),
    [visibleEdges, positions]
  );

  useEffect(() => {
    if (fitViewSignal === 0) return;
    requestAnimationFrame(() => fitView({ duration: 200, padding: 0.2 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitViewSignal]);

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={flowEdges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      nodesDraggable={arrangeMode}
      onNodesChange={arrangeMode ? onNodesChange : undefined}
      onNodeDragStart={arrangeMode ? onNodeDragStart : undefined}
      onNodeDrag={arrangeMode ? onNodeDrag : undefined}
      onNodeDragStop={arrangeMode ? onNodeDragStop : undefined}
      nodesConnectable={false}
      elementsSelectable={false}
      edgesFocusable={false}
      panOnScroll
      zoomOnScroll
      minZoom={0.1}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      aria-label="Interactive organization chart"
    >
      <Background />
      <Controls showInteractive={false} />
      <Panel position="top-right">
        <div className="text-muted-foreground bg-background/90 rounded-md border px-2 py-1 text-xs shadow-sm">
          {/* Counted apart, because a department heading is not a
              position — lumping them together would overstate how much
              of the company is on screen. */}
          {shownPositionCount} position{shownPositionCount === 1 ? "" : "s"}
          {shownDepartmentCount > 0
            ? ` · ${shownDepartmentCount} department${shownDepartmentCount === 1 ? "" : "s"}`
            : ""}{" "}
          shown
        </div>
      </Panel>
      <Panel position="bottom-left">
        <OrganogramLegend
          departments={departmentLegendEntries}
          colorMode={colorMode}
          families={familyLegendEntries}
        />
      </Panel>
    </ReactFlow>
  );
}

/** ReactFlowProvider is required for useReactFlow() (fitView) to work — scoped to just this canvas. */
export function OrganogramCanvas(props: OrganogramCanvasProps) {
  return (
    <div className="h-[65vh] min-h-[420px] w-full">
      <ReactFlowProvider>
        <CanvasInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}
