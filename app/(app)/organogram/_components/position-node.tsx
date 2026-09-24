"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { NODE_HEIGHT, NODE_WIDTH } from "@/app/(app)/organogram/_lib/elk-layout";
import type { OrganogramNode } from "@/lib/domain/organogram";
import type { FamilyColor } from "@/lib/domain/organogram-family-colors";

/** Which dimension drives a card's colour. Department is the default. */
export type OrganogramColorMode = "department" | "family";

/** Phase 9: how this node relates to the active search/filter/focus criteria — "none" (the Phase 8 default, no search/filter/focus active) never renders a Match/Context badge and never dims. */
export type PositionNodeMatchState = "none" | "match" | "context";

export interface PositionNodeData extends Record<string, unknown> {
  node: OrganogramNode;
  isCollapsed: boolean;
  hiddenDescendantCount: number;
  isSelected: boolean;
  onToggleCollapse: (positionId: string) => void;
  onSelect: (positionId: string) => void;
  matchState?: PositionNodeMatchState;
  /**
   * The card's fully-resolved fill + edge colour for the active colour mode
   * (department or sub-division), from the shared reference palette. The
   * canvas resolves it per node so the card just paints it. Null → neutral.
   */
  cardColor?: FamilyColor | null;
  /**
   * Arrange mode (managers only, off by default — docs/DECISIONS.md D21).
   * When on, a real position card clicks through to its Edit form instead of
   * the details panel, and shows inline Add-report / Delete controls. Never
   * applies to the synthetic department heading. The three callbacks are only
   * invoked while `arrangeMode` is true.
   */
  arrangeMode?: boolean;
  onEdit?: (positionId: string) => void;
  onAddChild?: (positionId: string) => void;
  onRequestDelete?: (positionId: string) => void;
}

/**
 * Never draggable (nodesDraggable={false} on the parent ReactFlow — MVP
 * behavior per docs/ORGANOGRAM_RENDERING.md), so there is no onDrag
 * handler here at all — dragging cannot mutate organizational data
 * because the capability doesn't exist on this node.
 *
 * The selectable area and the collapse-toggle are two SIBLING buttons,
 * not a button nested inside a role="button" container — axe's
 * `nested-interactive` rule (caught by e2e/accessibility.spec.ts, only
 * intermittently, depending on whether a visible node happened to have
 * children at scan time) flags a focusable descendant inside another
 * interactive element as a real screen-reader/focus hazard, not a false
 * positive. Same sibling-button pattern already used in
 * organogram-outline-view.tsx.
 */
/**
 * The synthetic department tier the Demo 1 feedback asked for ("the
 * department should act as the first grouping level below the
 * Founder/CEO"). Deliberately NOT styled like a person card: it is filled
 * rather than outlined, it carries no occupancy dot and no status badge,
 * and its whole surface is the expand/collapse control. A reader should
 * never have to work out whether a box is a human being.
 *
 * It is also not selectable — there is no Position behind it to open in
 * the details panel, so offering a click that does nothing would be a
 * placeholder control (CLAUDE.md §1.10). Drilling into the department
 * itself is still one click away from any member card's details panel.
 */
function DepartmentNodeCard({ data }: { data: PositionNodeData }) {
  const { node, isCollapsed, onToggleCollapse } = data;
  // A department heading answers "how big is this department?", so it
  // shows the department's TOTAL role count — every role nested anywhere
  // beneath it — not just the one or two that happen to hang directly off
  // the box in the collapsed leadership layout. `departmentMemberCount` is
  // that total (set by the projection); the display/ direct counts are the
  // fallback for any caller that hasn't populated it.
  const roleCount = node.departmentMemberCount ?? node.displayChildCount ?? node.directReportCount;
  // Fully colour-filled heading from the resolved card colour, with a thin
  // same-hue border and no left accent bar — matching the reference cards.
  const fill = data.cardColor?.fill;
  const border = data.cardColor?.accent ?? "var(--color-primary)";

  return (
    <div
      className={cn(
        "pointer-events-auto flex flex-col overflow-hidden rounded-lg border shadow-sm",
        !fill && "bg-muted"
      )}
      style={{
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        borderColor: border,
        backgroundColor: fill,
      }}
    >
      <Handle type="target" position={Position.Top} className="!bg-border !border-none" />
      <button
        type="button"
        onClick={() => onToggleCollapse(node.positionId)}
        aria-expanded={!isCollapsed}
        aria-label={`${node.departmentName} department, ${roleCount} role${roleCount === 1 ? "" : "s"}. ${isCollapsed ? "Expand" : "Collapse"}.`}
        className="focus-visible:ring-ring flex flex-1 flex-col justify-center rounded-[calc(0.5rem-2px)] px-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {node.hasChildren ? (
            isCollapsed ? (
              <ChevronRight aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
            ) : (
              <ChevronDown aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
            )
          ) : null}
          <p className="text-foreground line-clamp-2 text-sm leading-tight font-bold tracking-wide uppercase">
            {node.departmentName}
          </p>
        </div>
        <p className="text-muted-foreground mt-1 truncate text-xs">
          {roleCount} role{roleCount === 1 ? "" : "s"}
        </p>
      </button>
      <Handle type="source" position={Position.Bottom} className="!bg-border !border-none" />
    </div>
  );
}

function PositionNodeComponent({ data }: NodeProps & { data: PositionNodeData }) {
  const {
    node,
    isCollapsed,
    hiddenDescendantCount,
    isSelected,
    onToggleCollapse,
    onSelect,
    matchState = "none",
    cardColor = null,
    arrangeMode = false,
    onEdit,
    onAddChild,
    onRequestDelete,
  } = data;

  if (node.kind === "department") return <DepartmentNodeCard data={data} />;

  // Fully colour-filled from the resolved palette colour (exact reference
  // colours), with a thin same-hue border and no left accent bar, so the card
  // reads as one solid colour like the reference chart. No resolved colour →
  // neutral card.
  const cardBackground = cardColor?.fill;
  const borderColor = cardColor?.accent;

  // The card leads with the ROLE and adds the person underneath, matching
  // the company's own chart: most approved roles have nobody in them yet,
  // and stamping "Vacant" across ninety boxes reads as an alarm rather
  // than as a fact. An empty second line says the same thing quietly. The
  // accessible name below still states it outright, because a
  // screen-reader user cannot see that the line is absent.
  const occupantName = node.occupancyStatus === "occupied" ? node.occupantDisplayName : null;
  // What expanding this card will actually reveal. Once the leadership
  // filter hides some of a manager's reports, that is fewer than the real
  // `directReportCount` — which stays intact on the node for the details
  // panel, where the truthful number belongs.
  const displayChildCount = node.displayChildCount ?? node.directReportCount;
  const matchStateLabel =
    matchState === "match"
      ? " Search or filter match."
      : matchState === "context"
        ? " Context — shown to preserve the real reporting path."
        : "";

  return (
    <div
      className={cn(
        // @xyflow/react sets `pointer-events: none` (inline, inherited by
        // children) on the node wrapper whenever elementsSelectable/
        // nodesDraggable are both false and no onNodeClick is passed to
        // <ReactFlow> — all true here (Phase 8 is read-only, no native
        // React Flow selection/drag). pointer-events-auto overrides that
        // inherited value at this element so the buttons below actually
        // receive events — see e2e/organogram.spec.ts, which caught this
        // as a real click-through-to-the-pane failure before this fix.
        "pointer-events-auto relative flex flex-col overflow-hidden rounded-lg border shadow-sm transition-colors",
        // Neutral card background only when no colour fill applies.
        !cardBackground && "bg-background",
        // Selection/search override the border with a stronger ring; otherwise
        // the border is the card's own same-hue edge (inline below), falling
        // back to the neutral border only when the card has no colour.
        isSelected
          ? "border-primary"
          : matchState === "match"
            ? "border-primary/60"
            : !borderColor && "border-border",
        !node.isActive && node.positionStatus === "INACTIVE" && "opacity-75",
        // Context nodes dim, but never so far that the text becomes
        // unreadable (docs/ORGANOGRAM_SEARCH_AND_FOCUS.md "Visual
        // Semantics" — dimmed nodes must remain readable enough to
        // provide context) — paired with the "Context" badge below, so
        // opacity is never the only signal either.
        matchState === "context" && "opacity-60"
      )}
      style={{
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        // Own same-hue border, unless selection/match override it via class.
        borderColor: isSelected || matchState === "match" ? undefined : borderColor,
        backgroundColor: cardBackground,
      }}
    >
      <Handle type="target" position={Position.Top} className="!bg-border !border-none" />
      {arrangeMode ? (
        // Inline management controls (managers only, arrange mode).
        // `nodrag` keeps a click on these from starting a node drag, and
        // stopPropagation keeps it from also triggering the card's Edit
        // click behind them.
        <div className="nodrag absolute top-1 right-1 z-10 flex gap-1">
          <button
            type="button"
            aria-label={`Add a report to ${node.title}`}
            title="Add a direct report"
            onClick={(event) => {
              event.stopPropagation();
              onAddChild?.(node.positionId);
            }}
            className="border-border bg-background/90 text-muted-foreground hover:text-foreground focus-visible:ring-ring flex size-6 items-center justify-center rounded border shadow-sm outline-none focus-visible:ring-2"
          >
            <Plus aria-hidden="true" className="size-3.5" />
          </button>
          {onRequestDelete ? (
            <button
              type="button"
              aria-label={`Delete ${node.title}`}
              title="Delete this position"
              onClick={(event) => {
                event.stopPropagation();
                onRequestDelete(node.positionId);
              }}
              className="border-destructive/30 bg-background/90 text-destructive hover:bg-destructive/10 focus-visible:ring-destructive flex size-6 items-center justify-center rounded border shadow-sm outline-none focus-visible:ring-2"
            >
              <Trash2 aria-hidden="true" className="size-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}
      <button
        type="button"
        aria-pressed={arrangeMode ? undefined : isSelected}
        // Leads with what the card now shows visually, but deliberately
        // keeps the department and organizational level: they are useful
        // orientation for a screen-reader user, who cannot see that the
        // card sits underneath its department heading. Removing visual
        // clutter was the request; removing context from assistive tech
        // was not. In arrange mode the click opens the Edit form, so the
        // label says so.
        aria-label={`${arrangeMode ? `Edit ${node.title}` : node.title}. ${occupantName ?? "Vacant"}.${node.jobGradeCode ? ` Level ${node.jobGradeCode}.` : ""} ${node.departmentName}, organizational level ${node.organizationalLevel}.${node.positionStatus !== "ACTIVE" ? ` ${node.positionStatus === "PLANNED" ? "Planned" : "Inactive"}.` : ""}${matchStateLabel}`}
        onClick={() => (arrangeMode ? onEdit?.(node.positionId) : onSelect(node.positionId))}
        // Deliberately NOT `nodrag`: in arrange mode the whole card body is the
        // drag surface, and React Flow still fires this click when the pointer
        // is released without moving — so a click edits and a press-drag
        // re-parents, sharing one surface. The +/Delete/collapse controls stay
        // `nodrag` so they never start a drag.
        className="focus-visible:ring-ring flex flex-1 flex-col rounded-t-[calc(0.5rem-2px)] p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset"
      >
        {/* Compact leadership card (Demo 1 feedback): role, then the
            person in it, then the level. Deliberately NOT shown — the
            position code (an internal identifier of no use to a chart
            reader), the department name (the card already sits under its
            department, so repeating it was pure duplication), and the
            job-grade NAME (the grade CODE below says the same thing in
            three characters). All of it is still on the details panel,
            one click away. */}
        <div className="flex min-w-0 items-start justify-between gap-2">
          <p className="text-foreground truncate text-sm leading-tight font-semibold">
            {node.title}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            {matchState === "match" ? <Badge variant="default">Match</Badge> : null}
            {matchState === "context" ? <Badge variant="outline">Context</Badge> : null}
            {node.positionStatus !== "ACTIVE" ? (
              <Badge variant={node.positionStatus === "PLANNED" ? "outline" : "muted"}>
                {node.positionStatus === "PLANNED" ? "Planned" : "Inactive"}
              </Badge>
            ) : null}
          </div>
        </div>
        {occupantName ? (
          <p className="text-foreground/80 mt-1 truncate text-xs">{occupantName}</p>
        ) : null}
        {node.jobGradeCode || node.jobFamilyName ? (
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {node.jobGradeCode ? <span className="font-medium">{node.jobGradeCode}</span> : null}
            {node.jobGradeCode && node.jobFamilyName ? " · " : null}
            {node.jobFamilyName ?? null}
          </p>
        ) : null}
      </button>
      <div className="px-3 pb-3">
        {node.hasChildren ? (
          <button
            type="button"
            onClick={() => onToggleCollapse(node.positionId)}
            aria-expanded={!isCollapsed}
            aria-label={
              isCollapsed
                ? `Expand ${node.title}, ${hiddenDescendantCount} hidden position${hiddenDescendantCount === 1 ? "" : "s"}`
                : `Collapse ${node.title}`
            }
            className="nodrag text-muted-foreground hover:text-foreground focus-visible:ring-ring flex items-center gap-1 rounded text-xs outline-none focus-visible:ring-2"
          >
            {isCollapsed ? (
              <ChevronRight aria-hidden="true" className="size-3.5" />
            ) : (
              <ChevronDown aria-hidden="true" className="size-3.5" />
            )}
            {displayChildCount} direct report{displayChildCount === 1 ? "" : "s"}
            {isCollapsed && hiddenDescendantCount > 0 ? ` (+${hiddenDescendantCount} hidden)` : ""}
          </button>
        ) : (
          <p className="text-muted-foreground text-xs">No direct reports</p>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-border !border-none" />
    </div>
  );
}

export const PositionNode = memo(PositionNodeComponent);
export const NODE_TYPES = { positionNode: PositionNode };
