# ADR-0013: SVG-first, headless-browser-free organogram export rendering

## Status

Accepted (Phase 11)

## Context

Phase 11 requires generating PDF and PNG exports of the organogram that are visually accurate, respect the same hierarchy/filter/focus rules as the interactive chart, support large multi-page structures, and are generated and stored server-side (private storage, server-checked download authorization, a documented retention policy — see `docs/DECISIONS.md` A40, amending A4's original "client-side only" MVP assumption).

The organogram is currently rendered entirely client-side via React Flow + ELK.js (`docs/adr/0004-reactflow-elk.md`). A server-side renderer cannot reuse React Flow itself (it's a DOM/React library), so a new rendering path is needed — but it must not become a second, independently-computed hierarchy or layout implementation (`organogram-hierarchy-safety` skill's central rule).

## Decision

1. **Reuse, never reimplement, the data/layout layer.** The export pipeline calls the exact same `getOrganogramData`, Phase 9 focus/filter functions (`buildPositionFocusVisibleSet`, `buildDepartmentFocusVisibleSet`, `buildFilteredVisibleSet`, `computeFilterMatchIds`), and `computeElkLayout` (`app/(app)/organogram/_lib/elk-layout.ts`) the interactive chart already uses — confirmed to have no browser-API dependency, so it runs identically server-side. Edges are filtered to the visible-id set exactly as `organogram-canvas.tsx` already does; no new cycle-detection or ancestor-walk logic is written for export.
2. **Render to a self-contained SVG string first**, mirroring `PositionNode`'s visual language (card dimensions, department-color accent, status/match/context badges, vacant/planned labeling) as SVG shapes/text — no `<script>`, no external `xlink:href`/image references, no `foreignObject`, every text value XML-escaped.
3. **Convert that one SVG to both output formats** — `sharp` (SVG → PNG raster, already present as a working native-binding dependency of Next.js itself, confirmed to load and render in this environment) and `pdfkit` + `svg-to-pdfkit` (SVG → vector PDF, keeping text selectable). One shared renderer feeding both formats keeps PNG and PDF visually consistent by construction, rather than two independent drawing implementations drifting apart over time.
4. **No headless browser** (Puppeteer/Playwright) — despite Playwright's Chromium binary already being present in this dev sandbox for E2E testing, adding a browser-automation dependency to a production request path is a meaningfully heavier, slower, and more failure-prone runtime dependency than a pure-JS SVG/PDF/PNG pipeline, for no capability this app's visual requirements actually need.

## Rationale

- A server-generated file that must be privately stored, authorization-checked on download, and expire on a retention policy has no coherent client-side-only implementation — this is the core reasoning behind amending A4 (`docs/DECISIONS.md` A40).
- SVG is a natural intermediate representation for a node-and-edge diagram: it's already how this project's design language expresses shapes/text, both `sharp` and `pdfkit`/`svg-to-pdfkit` accept it directly, and hand-writing escaped SVG text/shapes is straightforward to unit-test deterministically (no rendering engine needed to verify structure).
- Reusing `computeElkLayout` rather than writing a second layout algorithm guarantees the exported structure matches what a viewer of the interactive chart would see — the same node ordering, the same spacing rules, the same direction.

## Alternatives Considered

- **Headless-browser screenshot/print-to-PDF (Puppeteer/Playwright rendering the actual React Flow canvas):** rejected as the _primary_ mechanism — the Phase 11 brief explicitly rules out "a low-resolution browser screenshot as the only export method," and a full page-render pipeline is a much heavier runtime dependency (a Chromium process per export) for a self-hosted Node deployment than a pure-JS conversion library. Also risks exporting only the current viewport rather than the complete authorized subgraph unless carefully engineered to avoid it — a failure mode explicit in this phase's own negative-scenario list (`docs/NEGATIVE_SCENARIOS.md` "Browser viewport exported instead of complete graph").
- **A second, hand-rolled layout algorithm independent of ELK:** rejected outright — would risk the exported chart's structure silently diverging from the interactive chart's, and duplicates logic for no benefit.
- **Canvas-based rasterization (`node-canvas`) instead of `sharp`:** `node-canvas` requires drawing every shape/text imperatively in JS rather than accepting a complete SVG document, meaning PNG and PDF would need separate drawing code instead of sharing one SVG generator; rejected in favor of the SVG-first approach's better consistency guarantee.

## Consequences

- The SVG generator (`lib/domain/export/svg-renderer.ts`) is the single place all three format-specific behaviors (department color, vacancy/planned styling, match/context styling, connector style) must stay correct — a defect there affects both PNG and PDF identically, which is the intended trade-off (one bug surface, not two).
- `pdfkit`/`svg-to-pdfkit`'s SVG feature support is not 100% of the SVG specification; the generator is deliberately restricted to the safe, well-supported subset (`rect`, `text`, `line`/`path` with basic strokes, `g` for grouping) rather than anything more advanced (gradients, filters, clip-paths), which also keeps the generator itself simpler to keep secure (no `foreignObject`, no scripting surface to accidentally reintroduce).
- Multi-page tiled PDF output (for large organograms) is implemented as repeated calls into the same per-tile SVG-slice-and-render path, not a separate code path — see `docs/ORGANOGRAM_EXPORT_GUIDE.md` for the pagination strategy.
