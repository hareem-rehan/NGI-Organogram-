# Organogram Export Guide — Dynamic Organogram Manager

Reference for Phase 11's server-side PDF/PNG organogram export. See `docs/adr/0013-organogram-export-rendering.md` for the architecture rationale (including the amendment of Phase-0 assumption A4) and `docs/DECISIONS.md` A40–A44 for the specific decisions this phase recorded.

## 1. Where to find it

There is no separate `/exports` route. Export is a dialog on the existing `/organogram` page, opened via the "Export" button — visible only to a user holding `exports:execute`.

## 2. Permissions

Gated end-to-end by `exports:execute` (`ADMIN`/`HR_EDITOR` only, `VIEWER` excluded — see `docs/AUTHORIZATION_MATRIX.md`). Every action — request, status check, list, cancel, download — independently calls `requirePermission("exports:execute")` in its own server action; reaching one step is never assumed to authorize the next.

## 3. Formats

- **PDF** — one document, laid out on real pages (A4 or A3 landscape), suitable for printing or sharing as a static document.
- **PNG** — a single raster image at 1×/2×/3× scale, suitable for embedding in a slide deck or document.

## 4. Scope

| Scope              | What it includes                                                                                                                                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FULL_COMPANY`     | Every safe (non-cyclic, connected) position in the company, subject to `includePlanned`.                                                                                                                                                                    |
| `CURRENT_VIEW`     | Whatever is on screen right now — reuses the interactive chart's own active focus/filter state (position, department, or filters), so "what you see is what you export." Falls back to the same result as `FULL_COMPANY` if nothing is focused or filtered. |
| `POSITION_FOCUS`   | The chosen position, its ancestor chain (as context), and its descendants down to the chosen depth (1/2/3/all).                                                                                                                                             |
| `DEPARTMENT_FOCUS` | Every position in the chosen department, plus cross-department ancestor context (e.g. a CEO outside the department but in the reporting chain).                                                                                                             |

All four scopes reuse the exact same Phase 9 focus/filter functions the interactive chart uses (`lib/domain/organogram-focus.ts`, `lib/domain/organogram-filters.ts`) via `lib/domain/export/subgraph.ts`'s `buildExportSubgraph` — never a reimplementation, and never an edge fabricated that doesn't already exist in the server-computed edge list.

## 5. PDF options

- **Page size**: A3 landscape (default) or A4 landscape.
- **Layout mode**:
  - `AUTO` (default) — fits the whole graph on one page if the resulting scale stays readable (≥ 0.5×); otherwise falls back to `MULTI_PAGE_TILED`.
  - `SINGLE_PAGE` — always shrinks to fit one page, regardless of readability.
  - `MULTI_PAGE_TILED` — an overview page (the whole graph, fit-to-page) plus detail tiles at natural (1:1) scale, with a small overlap between adjacent tiles so a connector crossing a tile boundary is visible on both pages.
- **Tile-page ceiling**: a `MULTI_PAGE_TILED` export whose tile grid would exceed 60 pages is rejected with a clear message ("narrow the scope, or export as PNG instead") rather than silently generating hundreds of pages — see §8.

## 6. PNG options

- **Scale**: 1×, 2× (default), or 3× the graph's natural pixel size.
- **Dimension/pixel ceiling**: a request whose resulting width, height, or total pixel count would exceed the supported maximum (`MAX_PNG_DIMENSION_PX`/`MAX_PNG_TOTAL_PIXELS`, a memory-safety ceiling) is rejected before rasterization even begins — never a blank or corrupt file.
- **Safe render-time limit (Phase 13.1, DEF-010)**: a materially tighter, performance-driven limit than the memory-safety ceiling above — 20,000,000 total pixels at the selected scale (roughly 250 positions at 1× scale for a typical grid-shaped chart; fewer at 2×/3× scale, since total pixels scale with the square of scale). A request over this limit is rejected immediately (before an export job is even created), with a message recommending PDF instead — PDF supports the same scale via multi-page tiling and is unaffected by this limit. The Export dialog shows a non-blocking warning when the current chart/scale combination is likely to exceed it, based on a rough client-side estimate; the server check (using the chart's real, post-layout dimensions) is the actual, authoritative enforcement. See `docs/PERFORMANCE_REPORT.md`'s Phase 13.1 addendum for the benchmark data this limit was derived from.

## 7. Display options

- **Include legend** — status and department color key.
- **Include company name and generated-date header** — company name, effective date, scope label.
- **Include "Confidential" label** — a visible confidentiality marker on the document.

All three default to on.

## 8. What export can never do

- **Never a screenshot of the visible browser viewport.** The server independently fetches the full authorized dataset and lays it out — export works identically whether or not anyone has the interactive chart open, and a collapsed/scrolled interactive view never limits what an export can include.
- **Never an independently recalculated hierarchy or layout.** Export reuses `getOrganogramData` (the same company-scoped, safety-filtered read the interactive chart uses) and `computeElkLayout` (the interactive chart's own ELK layout engine, confirmed pure/Node-compatible) — a fix to hierarchy safety or layout logic in one place fixes both.
- **Never silently attempts an unbounded-size export.** A pathologically wide hierarchy (one manager with hundreds of direct reports) is rejected fast via the PDF tile-page ceiling (§5) or the PNG pixel ceiling (§6) rather than hanging or producing an unusably large file — see `docs/DECISIONS.md` A43 for how this was discovered and fixed during Phase 11.
- **Never exposes a field the interactive chart itself doesn't already expose.** No salary, contact info, address, or SSO/auth data — the export renderer's node type has no such field to begin with, mirroring `OrganogramNode`'s existing confidentiality contract.

## 9. Rendering pipeline

One shared SVG generator (`lib/domain/export/svg-renderer.ts`) feeds both formats, so a fix to the visual rendering fixes PDF and PNG identically:

1. Fetch the authorized `OrganogramNode[]`/`OrganogramEdge[]` (`getOrganogramData`).
2. Resolve the requested scope/filters into a visible subgraph (`buildExportSubgraph`).
3. Reject if the subgraph exceeds `MAX_EXPORT_NODE_COUNT` (defensive-only — see `docs/DECISIONS.md` A42).
4. Compute layout (`computeElkLayout`, the interactive chart's own layout engine).
5. Render one self-contained SVG string (`renderOrganogramSvg`) — every text value passed through `escapeXmlText`, no `<script>`/`<foreignObject>`/external `<image>` reference ever emitted, deterministic given the same inputs.
6. Convert to the requested format: PNG via `sharp` (`png-renderer.ts`), or PDF via `pdfkit` + `svg-to-pdfkit` (`pdf-renderer.ts`), using pdfkit's own transform stack (`save`/`translate`/`scale`) to place the SVG on the page — `svg-to-pdfkit`'s own `width`/`height` option does NOT rescale content to fit, a real defect found and fixed during Phase 11 (`docs/DECISIONS.md` A43's sibling finding).

No headless browser (Puppeteer/Playwright) is used at any point, despite one being available in the sandbox — see ADR-0013's Alternatives Considered.

## 10. Storage, retention, and download authorization

- Generated file bytes are stored in Postgres (`ExportJob.generatedFile`), the same pattern Phase 10 established for `ImportJob.rawFile` — there is no object-storage service in this app.
- Retention window: 7 days from creation (`EXPORT_RETENTION_DAYS`). Unlike an import's raw upload, a **completed** export's bytes are still subject to this window — the whole point of retention here is bounding how long the already-generated file stays downloadable, not how long an unexecuted request stays actionable. Enforced lazily on the next read that touches the job (no background scheduler exists).
- A job can also be cancelled early (freeing its bytes before the retention window lapses) — a no-op, not an error, if the job already has no bytes to free.
- Every download re-runs the full company-scoped, status/expiry-checked lookup — a job id from another company, or an expired/cancelled/failed job, resolves to "not found," never returns bytes. Raw file bytes never appear in any action's response except the dedicated download action's own base64 payload.

## 11. Idempotency

Requesting a status check, listing job history, or downloading an already-`COMPLETED` job any number of times is a safe, read-only, repeatable operation — no re-generation, no state mutation. Cancelling an already-terminal job is a no-op.

## 12. Out of scope (Phase 11)

Per the Phase 11 task brief, none of the following were built in this phase: audit-log UI, user-administration UI, deployment, drag-and-drop hierarchy editing, dotted-line reporting, historical snapshots, or additional export formats beyond PDF/PNG (e.g. CSV export, despite the `exports:execute` permission's broader "Run PDF/PNG/CSV export" description in `docs/AUTHORIZATION_MATRIX.md` — CSV export remains unimplemented).
