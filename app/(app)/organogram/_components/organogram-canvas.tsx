"use client";

import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
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
  NODE_GAP,
  type LayoutPosition,
} from "@/app/(app)/organogram/_lib/elk-layout";
import { computeLayoutClusters } from "@/lib/domain/organogram-layout-clusters";
import { organogramCardSize } from "@/app/(app)/organogram/_lib/card-size";
import {
  equalizeRowHeights,
  DEFAULT_CARD_SIZE,
  sizeLookup,
  type CardSize,
} from "@/lib/domain/organogram-card-size";
import { effectiveTextStyle, type TextStyle } from "@/lib/domain/organogram-text-style";
import {
  placeCards,
  departmentOrderAfterDrop,
  type CardOffset,
} from "@/lib/domain/organogram-card-offsets";
import {
  collectDisplayedDescendants,
  judgeDrop,
  pickDropTargetAtPoint,
  pointerClientPoint,
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
import { chartCardColor, type FamilyColor } from "@/lib/domain/organogram-family-colors";

/**
 * Display tiers framed on first open: the root and the department row, so
 * both are readable straight away (user request, 2026-10-02).
 */
const READABLE_OPEN_TIERS = 2;
/**
 * Automatic framing never goes smaller than this (75%). Below it the framing
 * centres on the root and department row at this size, and the rest of the
 * chart is a pan away — rather than shrinking everything unreadably.
 */
const READABLE_MIN_ZOOM = 0.75;
/** "Zoom to branch" never zooms out further than this, so cards stay readable (D53). */
const READABLE_BRANCH_ZOOM = 0.6;
/** …nor in further than this, for a small branch. */
const BRANCH_MAX_ZOOM = 1.25;

/** Zoom levels offered in the zoom menu. */
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;
/** Screen-space margin around the automatically framed area. */
const FRAME_PADDING = 32;
/**
 * Space kept above the top card when framing: the zoom menu and the
 * "N positions shown" counter sit over the canvas's top edge, and must never
 * cover the root card.
 */
const FRAME_TOP = 64;

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
   * When on, every card drags. Dropping a position onto another card
   * re-parents it (`onReparent`); dropping any card on empty canvas places it
   * there for everyone (`onPlaceCard`, D38). Cards also expose Add-report /
   * Delete / Edit via the callbacks below. All are no-ops when off.
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
  /**
   * A department box was dropped onto a sibling department box (D33, D38):
   * the department ids of that row in their new order, and the dragged box.
   */
  onReorderDepartments?: (
    orderedDepartmentIds: string[],
    draggedNodeKey: string,
    previousOrderedIds?: string[]
  ) => void;
  /**
   * Saved card offsets from the automatic layout, keyed by node id (D38).
   * Cards without one sit where the layout puts them.
   */
  cardOffsets?: Readonly<Record<string, CardOffset>>;
  /** A card was dropped on empty canvas: its new offset from the automatic spot. */
  onPlaceCard?: (nodeKey: string, dx: number, dy: number) => void;
  /** A whole selected group placed at once (one Undo step, D49). Falls back to `onPlaceCard` per card. */
  onPlaceCards?: (moves: { nodeKey: string; dx: number; dy: number }[]) => void;
  /** Card text styles: chart-wide plus per-card overrides (D41). */
  textStyles?: { chart: TextStyle; cards: Readonly<Record<string, TextStyle>> };
  /** "Aa" on a card (Arrange mode): edit that one card's text style. */
  onEditStyle?: (nodeKey: string) => void;
  onEditCard?: (positionId: string) => void;
  onAddChild?: (positionId: string) => void;
  onRequestDelete?: (positionId: string) => void;
}

const NO_OFFSETS: Readonly<Record<string, CardOffset>> = {};

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
  onReorderDepartments,
  cardOffsets = NO_OFFSETS,
  onPlaceCard,
  onPlaceCards,
  textStyles,
  onEditStyle,
  onEditCard,
  onAddChild,
  onRequestDelete,
}: OrganogramCanvasProps) {
  const [positions, setPositions] = useState<Map<string, LayoutPosition>>(new Map());
  // Each card's own size for its content and text style (D47): only as tall
  // as its text, wider only when the text needs it.
  const naturalSizes = useMemo(
    () =>
      new Map<string, CardSize>(
        visibleNodes.map((node) => [
          node.positionId,
          organogramCardSize(
            node,
            effectiveTextStyle(textStyles?.chart, textStyles?.cards[node.positionId])
          ),
        ])
      ),
    [visibleNodes, textStyles]
  );
  // Cards on one row share the row's tallest height, so rows stay aligned.
  const cardSizes = useMemo(
    () => equalizeRowHeights(positions, naturalSizes),
    [positions, naturalSizes]
  );
  const sizeOf = useMemo(() => sizeLookup(cardSizes), [cardSizes]);
  const sizesKey = useMemo(
    () => [...naturalSizes].map(([id, s]) => `${id}:${s.width}x${s.height}`).join(","),
    [naturalSizes]
  );
  const naturalSizesRef = useRef(naturalSizes);
  useEffect(() => {
    naturalSizesRef.current = naturalSizes;
  });
  // Where each card is drawn: its automatic spot plus any HR-saved offset
  // (D38), nudged so no two cards ever overlap (e.g. after a collapse).
  const placedPositions = useMemo(
    () => placeCards(positions, cardOffsets, sizeOf, NODE_GAP),
    [positions, cardOffsets, sizeOf]
  );
  // Where a card is while it is being dragged (transient). Saved placements
  // live in `cardOffsets` (D38). Cleared whenever the visible set changes (a
  // re-layout) or arrange mode turns off.
  const [manualPositions, setManualPositions] = useState<Map<string, LayoutPosition>>(new Map());
  const { fitView, setCenter, setViewport, getNodes, screenToFlowPosition } = useReactFlow();
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
    const boxOf = (id: string) => {
      const p = computed.get(id);
      const size = naturalSizesRef.current.get(id) ?? DEFAULT_CARD_SIZE;
      return p ? { ...p, width: size.width, height: size.height } : undefined;
    };
    type Box = LayoutPosition & { width: number; height: number };
    const all = [...computed.keys()].map(boxOf).filter((b): b is Box => b !== undefined);
    if (all.length === 0) return;
    const top = visibleNodes
      .filter((n) => (n.displayDepth ?? n.organizationalLevel) <= READABLE_OPEN_TIERS)
      .map((n) => boxOf(n.positionId))
      .filter((b): b is Box => b !== undefined);
    const frame = (boxes: Box[]) => {
      const minX = Math.min(...boxes.map((p) => p.x));
      const maxX = Math.max(...boxes.map((p) => p.x + p.width));
      const minY = Math.min(...boxes.map((p) => p.y));
      const maxY = Math.max(...boxes.map((p) => p.y + p.height));
      const fitZoom = Math.min(
        (paneWidth - 2 * FRAME_PADDING) / (maxX - minX),
        (paneHeight - FRAME_TOP - FRAME_PADDING) / (maxY - minY)
      );
      return { minX, maxX, minY, fitZoom };
    };
    const whole = frame(all);
    // The whole chart when it fits at a readable zoom; otherwise the top tiers
    // (root, departments, their leaders) as large as they fit. If even those
    // are too wide (since D48 each box is centred over its own branch, so a
    // wide department sits far out), the root plus as many of the NEAREST
    // department boxes as fit readably, so the chart never opens on empty space.
    const nearestFit = (): Box[] => {
      const roots = visibleNodes
        .filter((n) => (n.displayDepth ?? n.organizationalLevel) <= 1)
        .map((n) => boxOf(n.positionId))
        .filter((b): b is Box => b !== undefined);
      if (roots.length === 0) return top;
      const rootCentre = roots.reduce((sum, b) => sum + b.x + b.width / 2, 0) / roots.length;
      const rest = top
        .filter((b) => !roots.includes(b))
        .sort(
          (a, b) =>
            Math.abs(a.x + a.width / 2 - rootCentre) - Math.abs(b.x + b.width / 2 - rootCentre)
        );
      const chosen = [...roots];
      for (const box of rest) {
        if (frame([...chosen, box]).fitZoom < READABLE_MIN_ZOOM) break;
        chosen.push(box);
      }
      return chosen;
    };
    const target =
      whole.fitZoom >= READABLE_MIN_ZOOM || top.length === 0
        ? whole
        : frame(top).fitZoom >= READABLE_MIN_ZOOM
          ? frame(top)
          : frame(nearestFit());
    const zoom = Math.min(1, Math.max(READABLE_MIN_ZOOM, target.fitZoom));
    requestAnimationFrame(() =>
      setViewport(
        {
          x: paneWidth / 2 - ((target.minX + target.maxX) / 2) * zoom,
          y: FRAME_TOP - target.minY * zoom,
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
      computeLayoutClusters(visibleNodes),
      (id) => naturalSizesRef.current.get(id) ?? DEFAULT_CARD_SIZE
    )
      .then((computed) => {
        if (cancelled || requestId !== layoutRequestId.current) return;
        setPositions(computed);
        const centerId = centerOnNodeIdRef.current;
        const centerPos = centerId ? computed.get(centerId) : undefined;
        requestAnimationFrame(() => {
          if (centerPos) {
            const size = naturalSizesRef.current.get(centerId!) ?? DEFAULT_CARD_SIZE;
            setCenter(centerPos.x + size.width / 2, centerPos.y + size.height / 2, {
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
  }, [nodeIdsKey, edgesKey, sizesKey]);

  // A re-layout (visible set changed) or leaving arrange mode discards any
  // transient drag offsets, so the auto-generated layout always reasserts.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setManualPositions((current) => (current.size === 0 ? current : new Map()));
  }, [nodeIdsKey, edgesKey, arrangeMode]);

  // Cards picked for a group move (Arrange mode): Shift+drag on empty space
  // draws a selection box, Shift+click adds or removes one card.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!arrangeMode) setSelectedIds((current) => (current.size === 0 ? current : new Set()));
  }, [arrangeMode]);

  // Drag bookkeeping (arrange mode only). Position changes stream in during a
  // drag; we mirror them into `manualPositions` so the card follows the
  // cursor. Only the dragged card moves (D38) — what the drop means is
  // decided on release.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (!arrangeMode) return;
      const selections = changes.filter((c) => c.type === "select");
      if (selections.length > 0) {
        setSelectedIds((current) => {
          const next = new Set(current);
          for (const change of selections) {
            if (change.type !== "select") continue;
            if (change.selected) next.add(change.id);
            else next.delete(change.id);
          }
          return next;
        });
      }
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

  /** Drops the transient drag position, so the card is drawn from layout + saved offset. */
  const releaseDrag = useCallback((draggedId: string) => {
    setManualPositions((current) => {
      if (!current.has(draggedId)) return current;
      const next = new Map(current);
      next.delete(draggedId);
      return next;
    });
  }, []);

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

  /** The card or department heading under the mouse pointer, if any. */
  const targetUnderPointer = useCallback(
    (event: unknown, dragged: Node): OrganogramNode | null => {
      // Judged by the pointer, not by overlap, so a drop lands exactly where
      // the user points, even when zoomed out (D35).
      const client = pointerClientPoint(event);
      if (!client) return null;
      const point = screenToFlowPosition(client);
      const rects = getNodes().map((n) => ({
        id: n.id,
        x: n.position.x,
        y: n.position.y,
        width: n.measured?.width ?? n.width ?? sizeOf(n.id).width,
        height: n.measured?.height ?? n.height ?? sizeOf(n.id).height,
      }));
      const targetId = pickDropTargetAtPoint(point, rects, dragged.id);
      return targetId ? (nodeById.get(targetId) ?? null) : null;
    },
    [getNodes, screenToFlowPosition, nodeById, sizeOf]
  );

  /**
   * What a dragged card's drop means. Only a real, non-root position can be
   * re-attached; a department box can swap places with a sibling department
   * box; everything else (the root, sub-division boxes) is only ever placed.
   */
  const judgeDropFor = useCallback(
    (event: unknown, dragged: Node): { targetId: string; verdict: DropVerdict } | null => {
      const draggedNode = nodeById.get(dragged.id);
      const isPlainPosition =
        (draggedNode?.kind ?? "position") === "position" &&
        draggedNode?.primaryReportsToPositionId !== null;
      if (!isPlainPosition) return null;
      const target = targetUnderPointer(event, dragged);
      if (!target) return null;
      return {
        targetId: target.positionId,
        verdict: judgeDrop(dragged.id, target, dragDescendantsRef.current),
      };
    },
    [nodeById, targetUnderPointer]
  );

  const onNodeDragStart = useCallback(
    (_event: unknown, node: Node) => {
      dragDescendantsRef.current = collectDisplayedDescendants(node.id, visibleEdges);
    },
    [visibleEdges]
  );

  const onNodeDrag = useCallback(
    (event: unknown, node: Node, nodes?: Node[]) => {
      // A group only ever moves (never re-attaches), so it has no drop target.
      if (nodes && nodes.length > 1) {
        setDropHint(null);
        return;
      }
      const judged = judgeDropFor(event, node);
      const next = judged ? { targetId: judged.targetId, valid: judged.verdict.valid } : null;
      setDropHint((current) =>
        current?.targetId === next?.targetId && current?.valid === next?.valid ? current : next
      );
    },
    [judgeDropFor]
  );

  const onNodeDragStop = useCallback(
    (event: unknown, node: Node, nodes?: Node[]) => {
      setDropHint(null);
      if (!arrangeMode) return;

      // A selected group is only ever placed, wherever it is let go: reporting
      // lines never change from a group drag.
      if (nodes && nodes.length > 1) {
        const moves: { nodeKey: string; dx: number; dy: number }[] = [];
        for (const moved of nodes) {
          const auto = positions.get(moved.id);
          if (auto) {
            moves.push({
              nodeKey: moved.id,
              dx: moved.position.x - auto.x,
              dy: moved.position.y - auto.y,
            });
          }
          releaseDrag(moved.id);
        }
        if (onPlaceCards) onPlaceCards(moves);
        else for (const m of moves) onPlaceCard?.(m.nodeKey, m.dx, m.dy);
        return;
      }

      const dragged = nodeById.get(node.id);

      // Placing a card: it stays exactly where it was let go, saved as an
      // offset from its automatic spot (D38) — only that card moves.
      const place = () => {
        const auto = positions.get(node.id);
        if (auto) onPlaceCard?.(node.id, node.position.x - auto.x, node.position.y - auto.y);
        releaseDrag(node.id);
      };

      // A department box dropped ONTO a sibling department box takes its
      // place in the order (D33), the whole department moving with it.
      if (dragged?.kind === "department") {
        const target = targetUnderPointer(event, node);
        if (
          target?.kind === "department" &&
          target.primaryReportsToPositionId === dragged.primaryReportsToPositionId
        ) {
          const row = visibleNodes
            .filter(
              (n) =>
                n.kind === "department" &&
                n.primaryReportsToPositionId === dragged.primaryReportsToPositionId
            )
            .map((n) => n.departmentId);
          onReorderDepartments?.(
            departmentOrderAfterDrop(row, dragged.departmentId, target.departmentId),
            node.id,
            row
          );
          releaseDrag(node.id);
          return;
        }
        place();
        return;
      }

      // A position dropped ONTO a card or department heading is re-attached
      // there (its branch moves with it); a refused drop says why and snaps
      // back. A drop on empty canvas places the card.
      const judged = judgeDropFor(event, node);
      if (!judged) {
        place();
        return;
      }
      if (judged.verdict.valid) onReparent?.(node.id, judged.verdict);
      else onInvalidDrop?.(judged.verdict.reason);
      releaseDrag(node.id);
    },
    [
      arrangeMode,
      onReparent,
      onInvalidDrop,
      onReorderDepartments,
      onPlaceCard,
      onPlaceCards,
      releaseDrag,
      judgeDropFor,
      targetUnderPointer,
      nodeById,
      visibleNodes,
      positions,
    ]
  );

  // The card colour for a node in the active mode: a department heading, or
  // any card in department mode, takes its department's palette colour; a
  // position in sub-division mode takes its sub-division's palette colour
  // (null when unclassified, leaving a neutral card).
  const resolveCardColor = useCallback(
    (node: OrganogramNode): FamilyColor | null =>
      chartCardColor(node, colorMode, departmentColorById, familyColorById),
    [colorMode, departmentColorById, familyColorById]
  );

  // Positions only change when the visible id/edge SET changes (the
  // effect above); selection/collapse state is derived here on every
  // render instead of a second effect, so toggling a node never re-runs
  // ELK and never needs to synchronize two pieces of state.
  // Zoom to a department's or sub-division's whole visible branch (D53).
  const zoomToBranch = useCallback(
    (nodeId: string) => {
      const childrenOf = new Map<string, string[]>();
      for (const edge of visibleEdges) {
        const list = childrenOf.get(edge.sourcePositionId) ?? [];
        list.push(edge.targetPositionId);
        childrenOf.set(edge.sourcePositionId, list);
      }
      const branch = new Set<string>([nodeId]);
      const queue = [nodeId];
      while (queue.length > 0) {
        for (const child of childrenOf.get(queue.shift()!) ?? []) {
          if (!branch.has(child)) {
            branch.add(child);
            queue.push(child);
          }
        }
      }
      // Fit the branch, but never below a readable zoom: a tall branch is
      // shown from its top at that zoom (scroll down for the rest).
      const boxes = [...branch]
        .map((id) => {
          const p = placedPositions.get(id);
          return p ? { ...p, ...sizeOf(id) } : null;
        })
        .filter((b): b is { x: number; y: number; width: number; height: number } => b !== null);
      if (boxes.length === 0 || paneWidth <= 0 || paneHeight <= 0) return;
      const minX = Math.min(...boxes.map((b) => b.x));
      const maxX = Math.max(...boxes.map((b) => b.x + b.width));
      const minY = Math.min(...boxes.map((b) => b.y));
      const maxY = Math.max(...boxes.map((b) => b.y + b.height));
      const fit = Math.min(
        (paneWidth - 2 * FRAME_PADDING) / (maxX - minX),
        (paneHeight - FRAME_TOP - FRAME_PADDING) / (maxY - minY)
      );
      const zoom = Math.min(BRANCH_MAX_ZOOM, Math.max(READABLE_BRANCH_ZOOM, fit));
      if (fit >= READABLE_BRANCH_ZOOM) {
        // The whole branch fits readably: centre it.
        void setViewport(
          {
            x: paneWidth / 2 - ((minX + maxX) / 2) * zoom,
            y: paneHeight / 2 - ((minY + maxY) / 2) * zoom,
            zoom,
          },
          { duration: 300 }
        );
        return;
      }
      // Too big to fit readably: the clicked box at the top centre, its
      // branch below it (scroll to see the rest).
      const head = boxes[0]!;
      void setViewport(
        { x: paneWidth / 2 - (head.x + head.width / 2) * zoom, y: FRAME_TOP - head.y * zoom, zoom },
        { duration: 300 }
      );
    },
    [visibleEdges, placedPositions, sizeOf, paneWidth, paneHeight, setViewport]
  );

  const flowNodes = useMemo<Node<PositionNodeData>[]>(
    () =>
      visibleNodes
        .filter((node) => positions.has(node.positionId))
        .map((node) => {
          // Every card drags in arrange mode (D38); only a non-root position
          // can be re-attached — the rest are placed (see onNodeDragStop).
          const isRoot = node.primaryReportsToPositionId === null;
          return {
            id: node.positionId,
            type: "positionNode",
            position: manualPositions.get(node.positionId) ?? placedPositions.get(node.positionId)!,
            width: sizeOf(node.positionId).width,
            height: sizeOf(node.positionId).height,
            draggable: arrangeMode,
            selected: arrangeMode && selectedIds.has(node.positionId),
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
              onEditStyle,
              groupSelected:
                arrangeMode && selectedIds.size > 1 && selectedIds.has(node.positionId),
              textStyle: effectiveTextStyle(textStyles?.chart, textStyles?.cards[node.positionId]),
              size: cardSizes.get(node.positionId),
              onZoomToBranch: zoomToBranch,
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
      placedPositions,
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
      onEditStyle,
      textStyles,
      cardSizes,
      sizeOf,
      zoomToBranch,
      selectedIds,
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
      // Arrange mode: Shift+drag on empty space draws a selection box (plain
      // drag still pans); Shift/Cmd/Ctrl+click adds or removes one card.
      elementsSelectable={arrangeMode}
      selectionKeyCode="Shift"
      multiSelectionKeyCode={["Shift", "Meta", "Control"]}
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
      {/* Overview of the whole chart (D53): drag or click it to move around,
          scroll on it to zoom — no more zooming out to find your place. */}
      {paneWidth > 0 && paneHeight > 0 ? (
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          ariaLabel="Chart overview"
          className="!hidden rounded-md border shadow-sm md:!block"
          style={{ width: 150, height: 96 }}
          nodeColor={(node) =>
            (node.data as PositionNodeData | undefined)?.cardColor?.fill ?? "#d4d4d8"
          }
          nodeStrokeWidth={0}
          maskColor="rgba(240, 240, 240, 0.6)"
        />
      ) : null}
      <Panel position="top-left">
        <ZoomMenu onFit={() => fitView({ padding: 0.1, duration: 200 })} />
      </Panel>
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

/**
 * The zoom menu (user request, 2026-10-02): shows the current zoom as a
 * percentage and jumps to a chosen level, or fits the whole chart. Stays in
 * sync when zooming with the mouse wheel or the +/- buttons.
 */
function ZoomMenu({ onFit }: { onFit: () => void }) {
  const { zoomTo } = useReactFlow();
  const zoom = useStore((state) => state.transform[2]);
  const percent = Math.round(zoom * 100);
  const isStep = ZOOM_STEPS.some((step) => Math.round(step * 100) === percent);
  return (
    <label className="bg-background/90 flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs shadow-sm">
      <span className="text-muted-foreground">Zoom</span>
      <select
        aria-label="Zoom level"
        value={isStep ? String(percent) : "current"}
        onChange={(event) => {
          if (event.target.value === "fit") onFit();
          else if (event.target.value !== "current") {
            zoomTo(Number(event.target.value) / 100, { duration: 200 });
          }
        }}
        className="bg-transparent text-xs font-semibold outline-none"
      >
        {isStep ? null : <option value="current">{percent}%</option>}
        {ZOOM_STEPS.map((step) => (
          <option key={step} value={String(Math.round(step * 100))}>
            {Math.round(step * 100)}%
          </option>
        ))}
        <option value="fit">Fit whole chart</option>
      </select>
    </label>
  );
}
