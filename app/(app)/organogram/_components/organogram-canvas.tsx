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
import {
  NODE_TYPES,
  type OrganogramColorMode,
  type PositionNodeData,
  type PositionNodeMatchState,
} from "@/app/(app)/organogram/_components/position-node";
import {
  OrganogramLegend,
  type FamilyLegendEntry,
} from "@/app/(app)/organogram/_components/organogram-legend";
import type { OrganogramEdge, OrganogramNode } from "@/lib/domain/organogram";
import type { FamilyColor } from "@/lib/domain/organogram-family-colors";

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
  onReparent?: (childPositionId: string, newParentPositionId: string) => void;
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
  onEditCard,
  onAddChild,
  onRequestDelete,
}: OrganogramCanvasProps) {
  const [positions, setPositions] = useState<Map<string, LayoutPosition>>(new Map());
  // Ephemeral per-session drag offsets in arrange mode — NEVER persisted (the
  // chart layout is always auto-generated, CLAUDE.md §0). Cleared whenever the
  // visible set changes (a re-layout) or arrange mode turns off.
  const [manualPositions, setManualPositions] = useState<Map<string, LayoutPosition>>(new Map());
  const { fitView, setCenter, getIntersectingNodes } = useReactFlow();
  const layoutRequestId = useRef(0);
  const centerOnNodeIdRef = useRef(centerOnNodeId);
  useEffect(() => {
    centerOnNodeIdRef.current = centerOnNodeId;
  });

  const nodeIdsKey = useMemo(() => visibleNodes.map((n) => n.positionId).join(","), [visibleNodes]);
  const edgesKey = useMemo(
    () => visibleEdges.map((e) => `${e.sourcePositionId}>${e.targetPositionId}`).join(","),
    [visibleEdges]
  );

  useEffect(() => {
    const requestId = ++layoutRequestId.current;
    let cancelled = false;

    void computeElkLayout(
      visibleNodes.map((n) => n.positionId),
      visibleEdges
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
            fitView({ duration: 200, padding: 0.2 });
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

  const onNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      if (!arrangeMode || !onReparent) return;
      // A drop ONTO another card re-parents; a drop on empty canvas is left as
      // a visual nudge. The target must be a real position (never the
      // synthetic department heading, which cannot be a manager) and never the
      // card itself.
      const target = getIntersectingNodes(node).find(
        (other) =>
          other.id !== node.id &&
          ((other.data as PositionNodeData | undefined)?.node?.kind ?? "position") === "position"
      );
      if (target) {
        onReparent(node.id, target.id);
        // Snap the dragged card back to the computed layout — the move either
        // succeeds (a re-layout follows) or is declined/blocked (it belongs
        // where the layout put it), so a half-dropped card should never linger.
        setManualPositions((current) => {
          if (!current.has(node.id)) return current;
          const next = new Map(current);
          next.delete(node.id);
          return next;
        });
      }
    },
    [arrangeMode, onReparent, getIntersectingNodes]
  );

  // The card colour for a node in the active mode: a department heading, or
  // any card in department mode, takes its department's palette colour; a
  // position in sub-division mode takes its sub-division's palette colour
  // (null when unclassified, leaving a neutral card).
  const resolveCardColor = useCallback(
    (node: OrganogramNode): FamilyColor | null => {
      // A sub-division grouping card always paints in its sub-division colour,
      // regardless of the active colour mode — it IS a sub-division.
      if (node.kind === "subdivision") {
        return node.jobFamilyId ? (familyColorById.get(node.jobFamilyId) ?? null) : null;
      }
      if (node.kind === "department") {
        return departmentColorById.get(node.departmentId) ?? null;
      }
      if (colorMode === "family") {
        return node.jobFamilyId ? (familyColorById.get(node.jobFamilyId) ?? null) : null;
      }
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
          type: "smoothstep",
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
      nodesDraggable={arrangeMode}
      onNodesChange={arrangeMode ? onNodesChange : undefined}
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
