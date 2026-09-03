# Organogram Rendering — Dynamic Organogram Manager

Authoritative reference for the interactive organogram (Phase 8). If the rendered chart doesn't match what's described here, this file wins and the code has a bug (`CLAUDE.md` §1.13/1.16). Companion to `docs/DASHBOARD_METRICS.md` (Phase 7) — the two features share conventions (effective-date occupancy, company scoping) but are otherwise independent. Search, filters, Position/Department Focus, and shareable deep links (Phase 9) are documented separately in `docs/ORGANOGRAM_SEARCH_AND_FOCUS.md` — that layer sits entirely on top of the contract and rendering rules described here and introduces no new server endpoint.

## 1. What generates the chart

The organogram is **entirely derived from live `Position`/`Department`/`JobGrade`/`PositionAssignment` data** on every load. There is no `x`/`y` column anywhere in the schema, no manual chart-editing UI, and no second source of truth — HR never positions a box. Layout is computed **client-side only**, on every expand/collapse, from the server's one payload.

```
lib/repositories/organogram.repository.ts   — bulk, N+1-free Postgres reads
        │
        ▼
lib/domain/organogram.ts                    — pure functions: safety analysis,
        │                                       graph building, visibility
        ▼
lib/services/organogram.service.ts          — orchestrates repo + domain,
        │                                       builds the final OrganogramData
        ▼
app/(app)/organogram/actions.ts              — organogram:view-gated server action
        │
        ▼
app/(app)/organogram/_components/*           — React Flow canvas (ELK layout,
                                                client-side only) + Outline View,
                                                both reading the SAME payload
```

## 2. Hierarchy data contract

One server action, `getOrganogramAction()`, returns the **entire** company hierarchy in one payload — `nodes`/`edges` cover every safe position, not just what's initially visible. Expand/collapse and the "Show planned positions" toggle are pure client-side filters over this one payload (`lib/domain/organogram.ts`'s `computeVisiblePositionIds`); collapsing a branch never triggers a second network request.

```ts
interface OrganogramData {
  company: { name: string; code: string; effectiveDate: string };
  nodes: OrganogramNode[];
  edges: OrganogramEdge[];
  safety: {
    hasRoot: boolean;
    extraRootCount: number; // always 0 under the current schema (DB partial unique index)
    cyclePositionCount: number; // positions excluded from nodes/edges — see §8
    disconnectedPositionCount: number; // positions excluded from nodes/edges — see §8
  };
}
```

### `OrganogramNode` — approved fields

| Field                                | Source                                                   | Notes                                                                                                                                                           |
| ------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `positionId`                         | `Position.id`                                            | —                                                                                                                                                               |
| `positionCode`                       | `Position.positionCode`                                  | —                                                                                                                                                               |
| `title`                              | `Position.title`                                         | —                                                                                                                                                               |
| `departmentId`/`Name`/`Code`/`Color` | `Department`                                             | Color is the department-based node accent — never the only status signal                                                                                        |
| `jobGradeName`                       | `JobGrade.name`                                          | `null` if the position has no job grade. Never conflated with `organizationalLevel`                                                                             |
| `organizationalLevel`                | `Position.organizationalLevel`                           | System-calculated, read-only here — this feature never writes it                                                                                                |
| `positionStatus`                     | `Position.status`                                        | `PLANNED` \| `ACTIVE` \| `INACTIVE`                                                                                                                             |
| `occupancyStatus`                    | Derived — currently-effective primary assignment exists? | `"occupied"` \| `"vacant"`, same exclusive-end convention as Phase 6/7 (`docs/DECISIONS.md` A18)                                                                |
| `occupantDisplayName`                | `Employee.preferredName ?? "First Last"`                 | `null` when vacant. **Never** the raw `Employee` record                                                                                                         |
| `occupantEmployeeId`                 | `Employee.id`                                            | `null` when vacant. Lets the Details Panel link to `/employees/[id]` for a caller who holds `employees:view` — that route re-checks authorization independently |
| `directReportCount`                  | Count of this position's safe direct children            | —                                                                                                                                                               |
| `primaryReportsToPositionId`         | `Position.primaryReportsToPositionId`                    | `null` for the root, and for any position whose real parent was excluded as unsafe (§8) — never a fabricated relationship                                       |
| `hasChildren`                        | `directReportCount > 0`                                  | —                                                                                                                                                               |
| `isPlanned` / `isActive`             | Derived from `positionStatus`                            | Convenience booleans for the UI layer                                                                                                                           |

### Explicit blacklist — never present on this contract

No salary, compensation, or benefits data; no personal email, phone, or home address; no employee SSO identity, auth role, or provider tokens; no other confidential HR field. This isn't an authorization filter applied at read time — **no such field exists on `OrganogramNode` at all**, so there's no code path that could leak it even accidentally.

### `OrganogramEdge`

```ts
interface OrganogramEdge {
  sourcePositionId: string;
  targetPositionId: string;
  reportingType: "PRIMARY";
}
```

Primary-reporting-only. There is no field for a secondary/dotted-line relationship anywhere in this contract — that's out of scope for Phase 8 (`docs/DECISIONS.md`), not merely hidden in the UI.

### Deterministic ordering

`nodes` is sorted by `organizationalLevel` ascending, then `title` (locale-aware), then `positionCode` — the same convention Phases 4–7 already use (e.g. `searchPositions`'s `orderBy`). Two requests against unchanged data always return the identical array order. `edges` is sorted by `sourcePositionId` then `targetPositionId`.

## 3. Layout engine

**ELK.js**, `layered` algorithm, direction `DOWN` (`app/(app)/organogram/_lib/elk-layout.ts`) — root at top, each reporting level one row down, siblings arranged horizontally. Approved at Phase 0 (`docs/adr/0004-reactflow-elk.md`), paired with **@xyflow/react** for the canvas/interaction layer. Both pinned exact versions (`@xyflow/react@12.11.6`, `elkjs@0.12.0`).

Layout runs **only on the currently-visible subgraph** (never the full up-to-2000-position graph), recomputed whenever the visible node/edge _set_ changes (expand/collapse, the planned toggle) — not on every render, and not on selection changes (`organogram-canvas.tsx` separates "positions changed" from "selection/collapse-state changed" into two independent update paths so toggling a node never re-runs ELK).

`NODE_WIDTH`/`NODE_HEIGHT` (260×152) are a single source of truth shared between the ELK spacing input and the `PositionNode` component's own fixed box size (`width`/`height` + `overflow-hidden`, with `truncate` on every text line). **Do not let these drift apart** — a height/content mismatch here previously caused adjacent rows to visually overlap, which broke click targeting (see `e2e/organogram.spec.ts`'s expand-toggle test, and the fix history in `docs/phase-reports/PHASE_08_INTERACTIVE_ORGANOGRAM.md`).

## 4. Node content (priority order)

Title → occupant name or **Vacant** → department name → organizational level → job grade (if any) → position code → status badge (Planned/Inactive only; Active is the unmarked default) → direct-report count / expand-collapse control. Department color renders as a left-border accent — paired with the text label, never the sole signal (WCAG 1.4.1).

## 5. Connectors

Solid, primary-reporting-only edges (manager → direct report), rendered via `smoothstep`. No dotted/secondary edges are ever produced by the server or the client — see the blacklist in §2.

## 6. Expand/collapse

Client-side UI state only (`Set<positionId>` of collapsed ids in `organogram-view.tsx`) — **never** written back to the server or the database, and never mistaken for organizational data. Toggling recomputes the visible subgraph via `computeVisiblePositionIds` and re-runs layout on it.

- **Default on load:** root (level 1) and its direct children (level 2) visible — every level-2 node with children starts collapsed.
- **Expand All / Collapse All:** toolbar controls. Collapse All collapses every position with children, including the root, so only the root row(s) remain visible.
- **Fit to View / Reset View:** Fit to View re-runs `fitView()` on the current visible graph. Reset View additionally restores the default collapse depth, turns "Show planned positions" back on, and clears the selection.
- A collapsed node shows its direct-report count plus a "(+N hidden)" total-descendant count (`countHiddenDescendants`).

## 7. Planned/Inactive visibility

**Both remain visible in the graph by default**, distinctly styled (status badge), never silently hidden. Recorded as an Assumption Requiring Confirmation in `docs/DECISIONS.md` (no prior phase settled this specifically for the organogram).

- A user-facing **"Show planned positions" toggle** (default **on**) lets a viewer hide Planned nodes (and their subtree) from both the canvas and the Outline View.
- There is **no toggle to hide Inactive positions.** An inactive position may be a structurally necessary ancestor for still-active descendants (`docs/DOMAIN_MODEL.md` §8's "an archived manager's direct reports still correctly point at it"). Hiding it would either break visual connectivity or require fabricating a false direct-reporting relationship — neither is acceptable.

## 8. Corrupted-data handling

`analyzeOrganogramSafety` (`lib/domain/organogram.ts`) checks **every** position, any status (unlike Phase 7's dashboard warnings, which are ACTIVE-only) — reusing the exact bounded, non-recursive ancestor-walk primitive Phase 7 established (`walkToRoot`, exported from `lib/domain/dashboard.ts` specifically for this reuse) rather than a second hierarchy-safety implementation.

| Condition                                         | Detection                                                                | Rendering behavior                                                                                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No positions at all                               | `rootPositionId === null`                                                | "No positions yet" empty state (never an error)                                                                                                                                                                    |
| Multiple roots                                    | `extraRootIds.length > 0`                                                | Structurally unreachable — DB partial unique index (`positions_one_root_per_company`) guarantees at most one position with a null parent per company, any status. Counted for forward-compatibility only           |
| Reporting cycle                                   | A position's ancestor walk revisits a node already seen in that walk     | The **entire cycle** is excluded from `nodes`/`edges` — never rendered with a guessed relationship. Traversal is bounded (`MAX_WALK_STEPS`), so a cycle can never hang or crash the app                            |
| Disconnected position                             | A position's ancestor walk terminates somewhere other than the true root | Excluded from `nodes`/`edges`, same as a cycle                                                                                                                                                                     |
| A safe position's real parent was itself excluded | `buildOrganogramGraph`'s `safeParentId` logic                            | The child's `primaryReportsToPositionId` is nulled out on the returned node — **no dangling edge is ever produced**, and the child still renders (just without a visible parent line) rather than disappearing too |

Any of the above produces a visible, non-blocking warning banner ("N positions have a data issue... and are not shown below") — the app **never freezes**, and corrupted data is **never auto-repaired**.

**Layout failure fallback:** if ELK itself throws (e.g. a pathological input), the canvas surfaces a message and the view falls back to Outline View, which reads the same safe data without needing spatial layout at all.

## 9. Accessibility — Outline View

A mandatory, always-available alternative to the canvas (`organogram-outline-view.tsx`): a semantic nested `<ul>`/`<li>` list reading the **exact same** server payload and the **exact same** visibility rules (collapse state, planned toggle) as the canvas — never a second hierarchy implementation. Each expandable row is a real `<button aria-expanded>`; row selection is a second button whose accessible name starts with the position title (deliberately, so `getByRole` lookups in tests can disambiguate it from the toggle's "Expand/Collapse {title}" name — see `e2e/organogram.spec.ts`).

The Details Panel is keyboard-closeable (`Escape`) and moves focus to its own heading on open, so a screen-reader user is told what changed.

## 10. Responsive behavior

Desktop: canvas + side Details Panel. Tablet/mobile: touch pan/pinch-zoom on the canvas; Outline View is the more usable path on narrow viewports (verified in `e2e/organogram.spec.ts` at 375×812 — no page-level horizontal overflow). The Legend is collapsed to a small toggle button by default on every viewport (see §12 for why).

## 11. Performance strategy

One bulk repository call (`getOrganogramRawData` — 4 concurrent queries: positions, departments, job grades, current-occupant assignments; **no per-node queries**), capped at 2000 positions (`docs/DECISIONS.md` P7, matching Phase 7's dashboard snapshot cap). ELK layout runs only on the visible subgraph. `PositionNode` is `React.memo`'d. A diagnostic performance test (analogous to Phase 7's `dashboard-performance.integration.test.ts`) exercises the service layer at ~1,000+ positions — see the phase report's "Performance Findings."

## 12. Security and privacy

`organogram:view`-gated (`app/(app)/organogram/actions.ts`), company-scoped exclusively from the authenticated session (`user.companyId` — never a client-supplied value), no confidential HR field on the contract by construction (§2's blacklist). The occupant-to-employee link in the Details Panel is additionally gated behind `employees:view`, and the destination route re-checks its own authorization independently — the organogram's own gate is never assumed sufficient elsewhere.

## 13. Known implementation notes

- **Node click-through bug (found and fixed during this phase):** `@xyflow/react` sets `pointer-events: none` (inline style, CSS-inherited by descendants) on a node's wrapper whenever `elementsSelectable`/`nodesDraggable` are both `false` and no `onNodeClick` handler is passed to `<ReactFlow>` — all true here, since Phase 8 is read-only. This silently made every click inside `PositionNode` unreachable (they'd land on the pane instead). Fixed with an explicit `pointer-events-auto` on the node's own root element, which overrides the inherited value for the whole subtree. Caught by `e2e/organogram.spec.ts`'s real-browser expand-toggle test, not by unit/component tests (jsdom doesn't reproduce this — see the phase report).
- **Legend overlap:** an always-open Legend panel was found to visually cover graph nodes for small hierarchies once Fit to View zoomed in, blocking clicks underneath it. Fixed by making the Legend collapsed-by-default (a small toggle button) and moving it into React Flow's own `Panel` overlay system.
- **Nested-interactive ARIA violation (found and fixed during this phase):** `PositionNode` originally wrapped the whole card in a `role="button"` div with the collapse/expand `<button>` nested inside it. Axe's `nested-interactive` rule only fires when a currently-visible node has children (and so renders the nested toggle), so this passed several full accessibility-suite runs before failing — found by deliberately re-running the suite multiple times rather than trusting one green pass. Fixed by making the selectable area and the collapse-toggle sibling `<button>` elements, matching the pattern `organogram-outline-view.tsx` already used.

## 14. Visual-regression baselines

`e2e/organogram-visual.spec.ts` captures the Visual View and Outline View for a small, fixed (non-timestamp-suffixed) fixture in an isolated company, so committed baseline PNGs never go stale from the wall clock moving. To intentionally update a baseline after a real visual change:

```bash
npx dotenv -e .env.test -- npx playwright test e2e/organogram-visual.spec.ts --project=chromium --update-snapshots
```

Review the diff before committing — a baseline update should always be a deliberate, reviewed decision, never a blind re-run to make a failing test pass.

## 15. Out of scope for Phase 8

Advanced search / filter-driven focus view, deep-linking, image/PDF export, drag-and-drop hierarchy editing (node dragging is disabled — `nodesDraggable={false}`), dotted-line/secondary reporting, CSV import/export, historical/future snapshots, full audit-log UI. See `docs/phase-reports/PHASE_08_INTERACTIVE_ORGANOGRAM.md` for the complete list and the explicit stop instruction it was built against.

**Update (Phase 9):** search, filter-driven focus view, and deep-linking are no longer out of scope — see `docs/ORGANOGRAM_SEARCH_AND_FOCUS.md`. Image/PDF export, drag-and-drop hierarchy editing, dotted-line/secondary reporting, CSV import/export, historical/future snapshots, and full audit-log UI remain out of scope per Phase 9's own explicit stop instruction (`docs/phase-reports/PHASE_09_SEARCH_FILTERS_AND_FOCUS.md`).
