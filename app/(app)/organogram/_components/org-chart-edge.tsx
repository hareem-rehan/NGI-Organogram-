"use client";

import { BaseEdge, type EdgeProps } from "@xyflow/react";

import { ORG_EDGE_BUS_OFFSET } from "@/app/(app)/organogram/_lib/elk-layout";

/**
 * Org-chart connector (docs/DECISIONS.md D31): straight down from the parent,
 * along ONE horizontal bar at a fixed height just below the parent, then
 * straight down into the child. Every child of the same parent shares that
 * exact bar, so a parent with several reports shows one clean bus instead of
 * several offset, rounded paths (React Flow's smoothstep routes each edge on
 * its own, which is what made connectors look tangled).
 */
export function OrgChartEdge({ id, sourceX, sourceY, targetX, targetY, style }: EdgeProps) {
  const busY = Math.min(sourceY + ORG_EDGE_BUS_OFFSET, targetY);
  const path = `M ${sourceX},${sourceY} V ${busY} H ${targetX} V ${targetY}`;
  return <BaseEdge id={id} path={path} style={style} />;
}

export const EDGE_TYPES = { org: OrgChartEdge };
