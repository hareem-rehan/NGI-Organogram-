"use client";

import "@xyflow/react/dist/style.css";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";

import {
  computeElkLayout,
  NODE_HEIGHT,
  NODE_WIDTH,
  type LayoutPosition,
} from "@/app/(app)/organogram/_lib/elk-layout";
import {
  NODE_TYPES,
  type PositionNodeData,
  type PositionNodeMatchState,
} from "@/app/(app)/organogram/_components/position-node";
import { OrganogramLegend } from "@/app/(app)/organogram/_components/organogram-legend";
import type { OrganogramEdge, OrganogramNode } from "@/lib/domain/organogram";

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
  matchStateById,
  centerOnNodeId,
}: OrganogramCanvasProps) {
  const [positions, setPositions] = useState<Map<string, LayoutPosition>>(new Map());
  const { fitView, setCenter } = useReactFlow();
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

  // Positions only change when the visible id/edge SET changes (the
  // effect above); selection/collapse state is derived here on every
  // render instead of a second effect, so toggling a node never re-runs
  // ELK and never needs to synchronize two pieces of state.
  const flowNodes = useMemo<Node<PositionNodeData>[]>(
    () =>
      visibleNodes
        .filter((node) => positions.has(node.positionId))
        .map((node) => ({
          id: node.positionId,
          type: "positionNode",
          position: positions.get(node.positionId)!,
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
          data: {
            node,
            isCollapsed: collapsedIds.has(node.positionId),
            hiddenDescendantCount: hiddenDescendantCounts.get(node.positionId) ?? 0,
            isSelected: selectedId === node.positionId,
            matchState: matchStateById?.get(node.positionId) ?? "none",
            onToggleCollapse,
            onSelect,
          } satisfies PositionNodeData,
        })),
    [
      visibleNodes,
      positions,
      collapsedIds,
      hiddenDescendantCounts,
      selectedId,
      matchStateById,
      onToggleCollapse,
      onSelect,
    ]
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
      nodesDraggable={false}
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
          {visibleNodes.length} position{visibleNodes.length === 1 ? "" : "s"} shown
        </div>
      </Panel>
      <Panel position="bottom-left">
        <OrganogramLegend departments={departmentLegendEntries} />
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
