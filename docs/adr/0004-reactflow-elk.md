# ADR-0004: React Flow (canvas) + ELK.js (layout) for the organogram

## Status

Accepted (Phase 0)

## Context

The core product requirement is that the organogram is **generated automatically** from position/reporting data — HR must never manually place chart nodes (`docs/PROJECT_SPEC.md` §1, FR-O1). The chart also needs interactive expand/collapse, zoom/pan/fit-to-screen/full-screen, and department-based grouping/coloring at a scale of up to ~2,000 positions (`docs/DECISIONS.md` P7).

## Decision

Render the organogram with **React Flow** as the interactive canvas (nodes, edges, zoom/pan/controls/minimap), and compute node positions with **ELK.js**'s layered layout algorithm, driven entirely by the position/reporting graph — never by manually stored coordinates.

## Rationale

- React Flow provides the interaction primitives (pan, zoom, fit-view, full-screen, minimap, custom node components) needed for FR-O3 out of the box, with a well-documented API for large graphs and virtualized rendering of off-screen nodes.
- ELK.js's layered algorithm is designed exactly for "vertical levels, horizontal grouping" hierarchical layouts, which matches the required visual model (departments horizontal, reporting levels vertical) without hand-tuning coordinates.
- Because layout is computed from the graph on every render (or on every structural change), there is no "saved x/y position" field anywhere in the data model — which structurally enforces FR-O1 (no manual node placement) rather than relying on UI discipline alone.
- Both libraries are framework-agnostic enough to run the layout computation server-side (for export/print) or client-side (for interactive re-layout on expand/collapse) as Phase 8 implementation decides.

## Alternatives Considered

- **d3-hierarchy / a hand-rolled tree-layout algorithm:** viable, but ELK's layered algorithm already handles the horizontal-grouping-plus-vertical-levels requirement with configurable options, avoiding a bespoke layout implementation.
- **A dedicated org-chart library (e.g. a commercial org-chart component):** rejected — proposal explicitly frames this as replacing a paid charting tool with company-owned tooling (proposal §2, §12); introducing a new paid/licensed charting dependency works against that goal.
- **Manual node positioning stored per-position:** directly violates the core product requirement (organogram is generated, not drawn) and was explicitly ruled out by the business rules.

## Consequences

- Expand/collapse must be implemented as a visible-subgraph filter that re-runs ELK layout on the reduced graph, not as a CSS show/hide of a fully-laid-out tree — otherwise collapsing a branch wouldn't reflow the remaining nodes.
- At ~2,000-position scale, layout computation cost needs to be measured in Phase 8; if full-graph ELK layout becomes a bottleneck, the mitigation is layout-per-visible-scope (lazy layout of collapsed branches only when expanded), which the "generated, not stored" architecture already supports.
