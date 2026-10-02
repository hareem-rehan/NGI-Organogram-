"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { NODE_HEIGHT, NODE_WIDTH } from "@/app/(app)/organogram/_lib/elk-layout";
import type { OrganogramNode } from "@/lib/domain/organogram";
import { CARD_TEXT_COLOR, type FamilyColor } from "@/lib/domain/organogram-family-colors";
import {
  DEFAULT_TITLE_SIZE,
  fontFamilyById,
  fontScaleOf,
  readableTextColor,
  textDecorationOf,
  type TextStyle,
} from "@/lib/domain/organogram-text-style";

/** Which dimension drives a card's colour. Department is the default. */
export type OrganogramColorMode = "department" | "family";

/** Phase 9: how this node relates to the active search/filter/focus criteria — "none" (the Phase 8 default, no search/filter/focus active) never renders a Match/Context badge and never dims. */
export type PositionNodeMatchState = "none" | "match" | "context";

/**
 * Secondary text (occupant, grade, counts, expand control) on a card. On a
 * colour-FILLED card it uses the full foreground colour: the reference
 * palette's stronger fills (e.g. Marketing orange) drop the muted grey below
 * WCAG AA, while the foreground stays >= 4.5:1 on every swatch
 * (organogram-family-colors.test.ts). Uncoloured cards keep the muted grey.
 */
function secondaryTextClass(fill: string | undefined): string {
  // On a coloured card all text inherits the card's own readable colour.
  return fill ? "" : "text-muted-foreground";
}

/**
 * The text colour for a coloured card: white or the dark card text,
 * whichever reads better on its (exact) colour. Undefined on a neutral card,
 * which keeps the theme's foreground.
 */
function cardTextColorOf(color: FamilyColor | null | undefined): string | undefined {
  return color?.fill ? (color.text ?? CARD_TEXT_COLOR) : undefined;
}

/**
 * Inline style + data attributes that apply a card's text style (D41) to
 * every line: family, size (the lines are sized in em, so they scale
 * together), colour, italic, and — via globals.css — weight and
 * underline/strikethrough. With no style set the built-in look is kept.
 */
function textStyleProps(style: TextStyle | undefined, cardColor: FamilyColor | null | undefined) {
  const s = style ?? {};
  const autoColor = cardTextColorOf(cardColor);
  // A chosen colour is kept only where it is readable on this card's fill
  // (a neutral card is white); otherwise the automatic readable colour.
  const color = s.color
    ? readableTextColor(s.color, cardColor?.fill ?? "#ffffff", autoColor ?? CARD_TEXT_COLOR)
    : autoColor;
  const family = fontFamilyById(s.fontFamily);
  const decoration = textDecorationOf(s);
  return {
    style: {
      fontSize: `${DEFAULT_TITLE_SIZE * fontScaleOf(s)}px`,
      fontFamily: family?.css,
      color,
      fontStyle: s.italic ? "italic" : undefined,
      ["--org-card-weight" as string]:
        s.bold === undefined || s.bold === null ? undefined : s.bold ? 700 : 400,
      ["--org-card-deco" as string]: decoration,
    } as React.CSSProperties,
    attrs: {
      "data-org-weight": s.bold === undefined || s.bold === null ? undefined : "",
      "data-org-deco": decoration ? "" : undefined,
    },
  };
}

/** A lighter divider for white text on a dark card; the theme's otherwise. */
function dividerColorOf(color: FamilyColor | null | undefined): string | undefined {
  return cardTextColorOf(color) === "#ffffff" ? "rgba(255,255,255,0.35)" : undefined;
}

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
  /** Opens the text-style panel for this one card (D41, Arrange mode). */
  onEditStyle?: (nodeKey: string) => void;
  /** Part of the current multi-card selection (Arrange mode). */
  groupSelected?: boolean;
  /** This card's effective text style (its own settings over the chart's), D41. */
  textStyle?: TextStyle;
  /**
   * Arrange-mode drop feedback while another card is dragged over this one:
   * "valid" (green ring — dropping here is allowed) or "invalid" (red ring —
   * e.g. it is the dragged card's own subordinate). Absent otherwise.
   */
  dropHint?: "valid" | "invalid";
}

/** Ring shown on a card while a dragged card hovers over it (arrange mode). */
function dropHintClass(
  hint: PositionNodeData["dropHint"],
  groupSelected?: boolean
): string | false {
  if (hint === "valid") return "ring-4 ring-emerald-500 ring-offset-2";
  if (hint === "invalid") return "ring-4 ring-red-600 ring-offset-2";
  // Part of a multi-card selection (Shift+drag / Shift+click in Arrange mode).
  if (groupSelected) return "ring-primary ring-2 ring-offset-2";
  return false;
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

  const cardText = textStyleProps(data.textStyle, data.cardColor);

  return (
    <div
      {...cardText.attrs}
      className={cn(
        "text-foreground pointer-events-auto relative flex flex-col overflow-hidden rounded-lg border shadow-sm",
        dropHintClass(data.dropHint, data.groupSelected),
        !fill && "bg-muted"
      )}
      style={{
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        borderColor: border,
        backgroundColor: fill,
        ...cardText.style,
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!size-px !min-h-0 !min-w-0 !border-none !bg-transparent"
      />
      <GroupAddButton data={data} />
      <button
        type="button"
        onClick={(event) => {
          // Shift+click selects (Arrange mode) instead of collapsing.
          if (event.shiftKey && data.arrangeMode) return;
          onToggleCollapse(node.positionId);
        }}
        aria-expanded={!isCollapsed}
        aria-label={`${node.departmentName} department, ${roleCount} role${roleCount === 1 ? "" : "s"}. ${isCollapsed ? "Expand" : "Collapse"}.`}
        className="focus-visible:ring-ring flex flex-1 flex-col justify-center rounded-[calc(0.5rem-2px)] px-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {node.hasChildren ? (
            isCollapsed ? (
              <ChevronRight
                aria-hidden="true"
                className={cn(secondaryTextClass(fill), "size-4 shrink-0")}
              />
            ) : (
              <ChevronDown
                aria-hidden="true"
                className={cn(secondaryTextClass(fill), "size-4 shrink-0")}
              />
            )
          ) : null}
          <p
            className={cn(
              "line-clamp-2 text-[1em] leading-tight font-extrabold tracking-wide uppercase",
              data.arrangeMode && "pr-14"
            )}
          >
            {node.departmentName}
          </p>
        </div>
        <p className={cn(secondaryTextClass(fill), "mt-1 truncate text-[0.923em] font-semibold")}>
          {roleCount} role{roleCount === 1 ? "" : "s"}
        </p>
      </button>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!size-px !min-h-0 !min-w-0 !border-none !bg-transparent"
      />
    </div>
  );
}

/**
 * The + on a department or sub-division box (Arrange mode, managers only):
 * opens Add Position pre-filled for that box — its department, its
 * sub-division, and the position just above it as the manager.
 */
function GroupAddButton({ data }: { data: PositionNodeData }) {
  const { node, arrangeMode, onAddChild, onEditStyle } = data;
  if (!arrangeMode || (!onAddChild && !onEditStyle)) return null;
  const label = node.kind === "department" ? node.departmentName : node.title;
  return (
    <div className="nodrag absolute top-1 right-1 z-10 flex gap-1">
      {onEditStyle ? (
        <StyleButton label={label} onClick={() => onEditStyle(node.positionId)} />
      ) : null}
      {onAddChild ? (
        <button
          type="button"
          aria-label={`Add a position in ${label}`}
          title="Add a position here"
          onClick={(event) => {
            event.stopPropagation();
            onAddChild(node.positionId);
          }}
          className="border-border bg-background/90 text-muted-foreground hover:text-foreground focus-visible:ring-ring flex size-6 items-center justify-center rounded border shadow-sm outline-none focus-visible:ring-2"
        >
          <Plus aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/** "Aa": opens the text-style panel for one card (D41). */
function StyleButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Text style for ${label}`}
      title="Text style for this card"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      // Fixed size and font: the button must not change with the card's own style.
      style={{ fontFamily: "var(--font-sans)", fontStyle: "normal", fontSize: "11px" }}
      className="border-border bg-background/90 text-muted-foreground hover:text-foreground focus-visible:ring-ring flex size-6 items-center justify-center rounded border font-bold shadow-sm outline-none focus-visible:ring-2"
    >
      Aa
    </button>
  );
}

/**
 * A synthetic sub-division grouping card, shown where a sub-division begins
 * under a position (docs/DECISIONS.md D25, refined). Styled like the department
 * heading — a filled, colour-coded grouping box whose whole surface is the
 * expand/collapse control — but labelled with the sub-division name (not
 * uppercased, since these are names like "UI/UX") and painted in its
 * sub-division colour. Not selectable/editable: it is grouping, not a seat.
 */
function SubdivisionNodeCard({ data }: { data: PositionNodeData }) {
  const { node, isCollapsed, onToggleCollapse } = data;
  const roleCount = node.departmentMemberCount ?? node.displayChildCount ?? node.directReportCount;
  const fill = data.cardColor?.fill;
  const border = data.cardColor?.accent ?? "var(--color-primary)";

  const cardText = textStyleProps(data.textStyle, data.cardColor);

  return (
    <div
      {...cardText.attrs}
      className={cn(
        "text-foreground pointer-events-auto relative flex flex-col overflow-hidden rounded-lg border shadow-sm",
        dropHintClass(data.dropHint, data.groupSelected),
        !fill && "bg-muted"
      )}
      style={{
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        borderColor: border,
        backgroundColor: fill,
        ...cardText.style,
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!size-px !min-h-0 !min-w-0 !border-none !bg-transparent"
      />
      <GroupAddButton data={data} />
      <button
        type="button"
        onClick={(event) => {
          // Shift+click selects (Arrange mode) instead of collapsing.
          if (event.shiftKey && data.arrangeMode) return;
          onToggleCollapse(node.positionId);
        }}
        aria-expanded={!isCollapsed}
        aria-label={`${node.title} sub-division, ${roleCount} role${roleCount === 1 ? "" : "s"}. ${isCollapsed ? "Expand" : "Collapse"}.`}
        className="focus-visible:ring-ring flex flex-1 flex-col justify-center rounded-[calc(0.5rem-2px)] px-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {node.hasChildren ? (
            isCollapsed ? (
              <ChevronRight
                aria-hidden="true"
                className={cn(secondaryTextClass(fill), "size-4 shrink-0")}
              />
            ) : (
              <ChevronDown
                aria-hidden="true"
                className={cn(secondaryTextClass(fill), "size-4 shrink-0")}
              />
            )
          ) : null}
          <p
            className={cn(
              "line-clamp-2 text-[1em] leading-tight font-extrabold",
              data.arrangeMode && "pr-14"
            )}
          >
            {node.title}
          </p>
        </div>
        <p className={cn(secondaryTextClass(fill), "mt-1 truncate text-[0.923em] font-semibold")}>
          {roleCount} role{roleCount === 1 ? "" : "s"}
        </p>
      </button>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!size-px !min-h-0 !min-w-0 !border-none !bg-transparent"
      />
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
  if (node.kind === "subdivision") return <SubdivisionNodeCard data={data} />;

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
  // The footer counts EVERY role under this position (its whole branch, as a
  // department heading does), not just direct reports — docs/DECISIONS.md D29.
  const rolesUnder = node.totalReportCount ?? node.displayChildCount ?? node.directReportCount;
  const matchStateLabel =
    matchState === "match"
      ? " Search or filter match."
      : matchState === "context"
        ? " Context — shown to preserve the real reporting path."
        : "";

  const cardText = textStyleProps(data.textStyle, data.cardColor);

  return (
    <div
      {...cardText.attrs}
      className={cn(
        // @xyflow/react sets `pointer-events: none` (inline, inherited by
        // children) on the node wrapper whenever elementsSelectable/
        // nodesDraggable are both false and no onNodeClick is passed to
        // <ReactFlow> — all true here (Phase 8 is read-only, no native
        // React Flow selection/drag). pointer-events-auto overrides that
        // inherited value at this element so the buttons below actually
        // receive events — see e2e/organogram.spec.ts, which caught this
        // as a real click-through-to-the-pane failure before this fix.
        "text-foreground pointer-events-auto relative flex flex-col overflow-hidden rounded-lg border shadow-sm transition-colors",
        dropHintClass(data.dropHint, data.groupSelected),
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
        ...cardText.style,
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!size-px !min-h-0 !min-w-0 !border-none !bg-transparent"
      />
      {arrangeMode ? (
        // Inline management controls (managers only, arrange mode).
        // `nodrag` keeps a click on these from starting a node drag, and
        // stopPropagation keeps it from also triggering the card's Edit
        // click behind them.
        <div className="nodrag absolute top-1 right-1 z-10 flex gap-1">
          {data.onEditStyle ? (
            <StyleButton label={node.title} onClick={() => data.onEditStyle?.(node.positionId)} />
          ) : null}
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
        onClick={(event) => {
          // Shift+click selects the card for a group move (Arrange mode).
          if (event.shiftKey && arrangeMode) return;
          if (arrangeMode) onEdit?.(node.positionId);
          else onSelect(node.positionId);
        }}
        // Deliberately NOT `nodrag`: in arrange mode the whole card body is the
        // drag surface, and React Flow still fires this click when the pointer
        // is released without moving — so a click edits and a press-drag
        // re-parents, sharing one surface. The +/Delete/collapse controls stay
        // `nodrag` so they never start a drag.
        className="focus-visible:ring-ring flex min-h-0 flex-1 flex-col rounded-t-[calc(0.5rem-2px)] px-2 pt-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset"
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
          <p
            className={`line-clamp-2 text-[1em] leading-[1.15] font-extrabold tracking-tight ${
              // Leave room for the Add / Delete buttons pinned top-right in
              // Arrange mode, so they never sit on top of the title.
              arrangeMode ? "pr-20" : ""
            }`}
          >
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
          <p className={cn("mt-0.5 truncate text-[0.923em] leading-[1.333] font-bold")}>
            {occupantName}
          </p>
        ) : null}
      </button>
      {/* Footer: how many roles sit under it (the expand control) on the
          left, the level (and sub-division) on the right — one row, so the
          card stays compact (docs/DECISIONS.md D30). */}
      <div
        className="border-foreground/15 mx-2 mb-1 flex min-w-0 items-center justify-between gap-2 border-t pt-1"
        style={{ borderTopColor: dividerColorOf(cardColor) }}
      >
        {node.hasChildren ? (
          <button
            type="button"
            onClick={(event) => {
              // Shift+click selects (Arrange mode) instead of collapsing.
              if (event.shiftKey && data.arrangeMode) return;
              onToggleCollapse(node.positionId);
            }}
            aria-expanded={!isCollapsed}
            aria-label={
              isCollapsed
                ? `Expand ${node.title}, ${hiddenDescendantCount} hidden position${hiddenDescendantCount === 1 ? "" : "s"}`
                : `Collapse ${node.title}`
            }
            className={cn(
              "nodrag hover:text-foreground focus-visible:ring-ring flex shrink-0 items-center gap-0.5 rounded text-[0.846em] font-semibold outline-none focus-visible:ring-2",
              secondaryTextClass(cardBackground)
            )}
          >
            {isCollapsed ? (
              <ChevronRight aria-hidden="true" className="size-3.5" />
            ) : (
              <ChevronDown aria-hidden="true" className="size-3.5" />
            )}
            <span className="font-extrabold">{rolesUnder}</span>
            {rolesUnder === 1 ? " role under" : " roles under"}
          </button>
        ) : (
          // No expand control here (nothing is drawn directly under this card
          // — e.g. its reports sit under their own department box), but the
          // count is still the real one.
          <p
            className={cn(
              secondaryTextClass(cardBackground),
              "shrink-0 text-[0.846em] font-semibold"
            )}
          >
            {rolesUnder > 0 ? (
              <>
                <span className="font-extrabold">{rolesUnder}</span>
                {rolesUnder === 1 ? " role under" : " roles under"}
              </>
            ) : (
              "No roles under"
            )}
          </p>
        )}
        {node.jobGradeCode || node.jobFamilyName ? (
          <p
            className={cn(
              secondaryTextClass(cardBackground),
              "min-w-0 truncate text-right text-[0.846em] font-semibold"
            )}
          >
            {node.jobGradeCode ? <span className="font-extrabold">{node.jobGradeCode}</span> : null}
            {node.jobGradeCode && node.jobFamilyName ? " · " : null}
            {node.jobFamilyName ?? null}
          </p>
        ) : null}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!size-px !min-h-0 !min-w-0 !border-none !bg-transparent"
      />
    </div>
  );
}

export const PositionNode = memo(PositionNodeComponent);
export const NODE_TYPES = { positionNode: PositionNode };
