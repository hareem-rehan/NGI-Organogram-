"use client";

import { useMemo } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { OrganogramNode } from "@/lib/domain/organogram";
import type { PositionNodeMatchState } from "@/app/(app)/organogram/_components/position-node";

interface OutlineNodeRowProps {
  node: OrganogramNode;
  childrenByParent: ReadonlyMap<string, OrganogramNode[]>;
  collapsedIds: ReadonlySet<string>;
  showPlanned: boolean;
  selectedId: string | null;
  visibleIds?: ReadonlySet<string>;
  matchStateById?: ReadonlyMap<string, PositionNodeMatchState>;
  onToggleCollapse: (positionId: string) => void;
  onSelect: (positionId: string) => void;
}

function OutlineNodeRow({
  node,
  childrenByParent,
  collapsedIds,
  showPlanned,
  selectedId,
  visibleIds,
  matchStateById,
  onToggleCollapse,
  onSelect,
}: OutlineNodeRowProps) {
  const children = (childrenByParent.get(node.positionId) ?? []).filter(
    (child) =>
      (showPlanned || !child.isPlanned) && (!visibleIds || visibleIds.has(child.positionId))
  );
  const isCollapsed = collapsedIds.has(node.positionId);
  const isSelected = selectedId === node.positionId;
  // No "Vacant" stamp, matching the card: an unfilled role simply has no
  // name line. See position-node.tsx for why.
  const occupantName = node.occupancyStatus === "occupied" ? node.occupantDisplayName : null;
  const matchState = matchStateById?.get(node.positionId) ?? "none";
  // The synthetic grouping tiers (department, sub-division) from
  // lib/domain/organogram-leadership-graph.ts. Same reasoning as the canvas
  // card: a heading is not a seat, so it shows no occupant and opens no
  // details panel.
  const isDepartment = node.kind === "department";
  const isGrouping = isDepartment || node.kind === "subdivision";

  return (
    <li>
      <div
        className={cn(
          "flex items-center gap-1.5 rounded px-1.5 py-1",
          isSelected && "bg-accent",
          matchState === "context" && "opacity-60"
        )}
      >
        {children.length > 0 ? (
          <button
            type="button"
            onClick={() => onToggleCollapse(node.positionId)}
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? `Expand ${node.title}` : `Collapse ${node.title}`}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring shrink-0 rounded outline-none focus-visible:ring-2"
          >
            {isCollapsed ? (
              <ChevronRight aria-hidden="true" className="size-4" />
            ) : (
              <ChevronDown aria-hidden="true" className="size-4" />
            )}
          </button>
        ) : (
          <span aria-hidden="true" className="inline-block size-4 shrink-0" />
        )}
        {isGrouping ? (
          <p
            className={cn(
              "text-foreground flex-1 px-1 text-sm font-bold",
              isDepartment ? "tracking-wide uppercase" : "font-semibold"
            )}
          >
            {isDepartment ? node.departmentName : node.title}
            <span className="text-muted-foreground ml-2 text-xs font-normal normal-case">
              {/* The group's TOTAL role count (every role nested under the
                  heading), matching the visual chart's card — not just the one
                  or two roles that hang directly off it. */}
              {(() => {
                const count = node.departmentMemberCount ?? children.length;
                return `${count} role${count === 1 ? "" : "s"}`;
              })()}
            </span>
          </p>
        ) : (
          <button
            type="button"
            onClick={() => onSelect(node.positionId)}
            className="focus-visible:ring-ring flex flex-1 flex-wrap items-center gap-x-2 rounded px-1 text-left text-sm outline-none focus-visible:ring-2"
          >
            {/* Role first, then whoever holds it — the same order, and the
                same three fields, as the canvas card. The two views must
                describe a person the same way round, and an e2e helper
                that queries "the card for X" addresses both. */}
            <span className="text-foreground font-medium">{node.title}</span>
            {occupantName ? <span className="text-foreground/80">{occupantName}</span> : null}
            {node.jobGradeCode ? (
              <span className="text-muted-foreground text-xs font-medium">{node.jobGradeCode}</span>
            ) : null}
            {matchState === "match" ? <Badge variant="default">Match</Badge> : null}
            {matchState === "context" ? <Badge variant="outline">Context</Badge> : null}
            {node.positionStatus !== "ACTIVE" ? (
              <Badge variant={node.positionStatus === "PLANNED" ? "outline" : "muted"}>
                {node.positionStatus === "PLANNED" ? "Planned" : "Inactive"}
              </Badge>
            ) : null}
          </button>
        )}
      </div>
      {children.length > 0 && !isCollapsed ? (
        <ul className="border-border ml-4 flex flex-col gap-0.5 border-l pl-2">
          {children.map((child) => (
            <OutlineNodeRow
              key={child.positionId}
              node={child}
              childrenByParent={childrenByParent}
              collapsedIds={collapsedIds}
              showPlanned={showPlanned}
              selectedId={selectedId}
              visibleIds={visibleIds}
              matchStateById={matchStateById}
              onToggleCollapse={onToggleCollapse}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

interface OrganogramOutlineViewProps {
  /** ALL nodes the server returned (not just the visually-visible subset) — the outline reads the exact same payload and applies the exact same collapse/planned-visibility rules, never a second data source. */
  nodes: readonly OrganogramNode[];
  collapsedIds: ReadonlySet<string>;
  showPlanned: boolean;
  selectedId: string | null;
  /** Phase 9: when a search/filter/focus is active, restricts which nodes render — the exact same match+context node-id set the canvas uses (lib/domain/organogram-focus.ts), so Visual and Outline Views can never diverge on what's shown (docs/ORGANOGRAM_SEARCH_AND_FOCUS.md). Omitted, this behaves exactly as Phase 8 (every node, subject only to collapse/planned). */
  visibleIds?: ReadonlySet<string>;
  matchStateById?: ReadonlyMap<string, PositionNodeMatchState>;
  onToggleCollapse: (positionId: string) => void;
  onSelect: (positionId: string) => void;
}

export function OrganogramOutlineView({
  nodes,
  collapsedIds,
  showPlanned,
  selectedId,
  visibleIds,
  matchStateById,
  onToggleCollapse,
  onSelect,
}: OrganogramOutlineViewProps) {
  const { roots, childrenByParent } = useMemo(() => {
    const childrenByParent = new Map<string, OrganogramNode[]>();
    for (const node of nodes) {
      if (node.primaryReportsToPositionId) {
        const list = childrenByParent.get(node.primaryReportsToPositionId) ?? [];
        list.push(node);
        childrenByParent.set(node.primaryReportsToPositionId, list);
      }
    }
    const roots = nodes.filter(
      (node) =>
        node.primaryReportsToPositionId === null && (!visibleIds || visibleIds.has(node.positionId))
    );
    return { roots, childrenByParent };
  }, [nodes, visibleIds]);

  if (roots.length === 0) {
    return (
      <p className="text-muted-foreground p-4 text-sm">
        {visibleIds ? "No matching positions to display." : "No positions to display."}
      </p>
    );
  }

  return (
    <ul aria-label="Organization outline" className="flex flex-col gap-0.5 p-2">
      {roots.map((root) => (
        <OutlineNodeRow
          key={root.positionId}
          node={root}
          childrenByParent={childrenByParent}
          collapsedIds={collapsedIds}
          showPlanned={showPlanned}
          selectedId={selectedId}
          visibleIds={visibleIds}
          matchStateById={matchStateById}
          onToggleCollapse={onToggleCollapse}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}
