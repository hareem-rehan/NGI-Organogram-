"use client";

import { BaseEdge, type Edge, type EdgeProps } from "@xyflow/react";

import { orgEdgeBusY } from "@/app/(app)/organogram/_lib/elk-layout";

/**
 * Org-chart connector (docs/DECISIONS.md D31): straight down from the parent,
 * along ONE horizontal bar at a fixed height just below the parent, then
 * straight down into the child. Every child of the same parent shares that
 * exact bar, so a parent with several reports shows one clean bus instead of
 * several offset, rounded paths (React Flow's smoothstep routes each edge on
 * its own, which is what made connectors look tangled).
 */
export function OrgChartEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  data,
}: EdgeProps<Edge<{ busTop?: number }>>) {
  // The shared bar sits halfway down the gap ABOVE the head's highest report
  // (D47): rows are top-aligned, so every bar into one row lines up even
  // when the cards above have different heights, and reports nudged to
  // slightly different heights still share the one bar.
  const busY = orgEdgeBusY(sourceY, targetY, data?.busTop);
  const path = `M ${sourceX},${sourceY} V ${busY} H ${targetX} V ${targetY}`;
  return <BaseEdge id={id} path={path} style={style} />;
}

export const EDGE_TYPES = { org: OrgChartEdge };
