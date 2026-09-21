# Organogram Search, Filters, and Focus — Dynamic Organogram Manager

Authoritative reference for Phase 9. If the app's behavior doesn't match this file, this file wins and the code has a bug (`CLAUDE.md` §1.13/1.16). Companion to `docs/ORGANOGRAM_RENDERING.md` (Phase 8) — this file only covers what Phase 9 added on top of that contract.

## 1. Architecture — everything is client-side over the existing Phase 8 payload

`getOrganogramAction()` (Phase 8) already returns the company's **entire** hierarchy (capped at 2,000 positions, `docs/DECISIONS.md` P7) in one `organogram:view`-gated call. Every field this phase's search and filters need — position title, position code, occupant display name, department name/code, organizational level, job grade, occupancy, status — is already present on the `OrganogramNode[]` that call returns.

Given that, **Phase 9 introduces no new server operation.** Search, filtering, and structural-context computation are pure, unit-tested TypeScript functions (`lib/domain/organogram-search.ts`, `organogram-filters.ts`, `organogram-focus.ts`) that run entirely in the browser over the array already fetched. This is a deliberate architectural choice, not an oversight — see `docs/DECISIONS.md` for the full reasoning, summarized here:

- **Company scoping and authorization are satisfied by construction.** These functions can only ever operate on data the caller was already authorized to fetch — there is no second endpoint to separately get wrong.
- **No stale-response problem exists.** There is no network round-trip to race; a later keystroke's recompute simply supersedes an earlier one synchronously.
- **Performance is trivial at the documented scale.** In-memory `Set`/`Map` operations over ≤2,000 already-loaded objects complete in well under a millisecond — see §11.
- **Employee code is deliberately not a search field.** The phase brief allowed it "only if authorized and approved" — no such approval exists, and `OrganogramNode` doesn't carry employee code at all (only `occupantDisplayName`/`occupantEmployeeId`, per Phase 8's field whitelist). Widening the contract for an unapproved field was rejected as the less-safe option.
- **`Position.location` is not a filter field**, despite appearing in `docs/PROJECT_SPEC.md` FR-O6 and `docs/IMPLEMENTATION_PLAN.md`'s Phase 9 entry. It's free text (`docs/DATA_DICTIONARY.md`, 0–100 chars, no enum), making an exact-match filter low-value UX. This phase's own explicit filter list (department, level, job grade, occupancy, status, planned) does not include it — followed as the more specific, current instruction. Recorded in `docs/DECISIONS.md`.

## 2. Searchable fields

Position title, position code, occupant display name (or the literal absence of one — a vacant position is fully searchable by its own title/code), department name, department code. Case-insensitive substring match; internal whitespace is collapsed before matching.

## 3. Search limits

| Limit                             | Value                                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Minimum query length (after trim) | 2 characters                                                                                                                                     |
| Maximum query length              | 100 characters (excess is truncated, not rejected)                                                                                               |
| Maximum results returned          | 20                                                                                                                                               |
| Debounce                          | 150ms client-side, purely to avoid recomputing on every keystroke against a large array — not a network debounce, since there is no network call |

## 4. Ranking

Exact matches rank above partial matches of any field. Within each tier, the priority order is **position code → title → occupant → department**. Ties break by organizational level, then title, then position code (the same deterministic tie-break Phase 8 already established for node ordering) — identical input always produces identical output, `lib/domain/organogram-search.test.ts`.

## 5. Filter definitions

| Filter                 | Field                                                                                         | Notes                                                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Department             | `Position.departmentId`                                                                       | Multi-select; membership is strictly position-based — no automatic child-department inclusion                                      |
| Organizational Level   | `Position.organizationalLevel`                                                                | Multi-select; **never** derived from job grade                                                                                     |
| Job Grade              | `Position.jobGradeId`                                                                         | Multi-select; a `null` sentinel represents "Not Assigned" (`Position.jobGradeId IS NULL`), never confused with "no filter applied" |
| Occupancy              | Derived, exclusive-end effective assignment (Phase 6/7/8 convention, `docs/DECISIONS.md` A18) | All / Occupied / Vacant                                                                                                            |
| Position Status        | `Position.status`                                                                             | Multi-select from `PLANNED`/`ACTIVE`/`INACTIVE`; kept fully independent of occupancy                                               |
| Show planned positions | The existing Phase 8 toggle, now URL-persisted                                                | Gates whether `PLANNED` positions appear in the graph _at all_, applied before the Position Status filter narrows further          |

Combined filters narrow the result set (AND across fields, OR within a multi-select field's own values) — never widen it. Filter _options_ shown in the UI are derived from the departments/levels/grades actually present among the company's positions, never a fixed universe with phantom empty categories.

## 6. Match versus Context behavior (false-edge prevention)

**The critical invariant: never connect two positions that do not directly report to each other.**

How it's guaranteed, structurally: `lib/domain/organogram-focus.ts` only ever computes a **node-id set** (`matchIds`, `contextIds`, and their union `visibleIds`). It never builds or modifies an edge. The UI always renders edges by filtering Phase 8's existing, already-server-computed, already-safe `edges` array down to pairs where **both endpoints are in the computed visible set**. A filtered-out intermediary manager is therefore either:

- pulled back in as non-matching **Context** (its real edge to its own manager, and its real edge to the match beneath it, both still render), or
- if the match's manager chain leads somewhere excluded for an unrelated reason, that ancestor is _also_ pulled in as context — the walk always continues to the true root.

No code path here can produce an edge that didn't already exist in the safe, server-computed graph.

| Scenario                        | Behavior                                                                                                                                                        | Evidence                                                                                                                                               |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One match                       | Match + its full ancestor chain as context                                                                                                                      | `organogram-focus.test.ts` "one match includes all of its real ancestors as context"                                                                   |
| Multiple matches in one branch  | Ancestors shared, never duplicated                                                                                                                              | "multiple matches in one branch share common ancestors without duplication"                                                                            |
| Matches across departments      | Common root pulled in once as shared context                                                                                                                    | "matches across departments share the common root as context"                                                                                          |
| Match with a collapsed ancestor | The collapse toggle un-collapses automatically on selection (search result path) or the ancestor still renders as context (filter path) — never silently hidden | `organogram-view.tsx`'s collapse-reset effect; `e2e/organogram-search-and-focus.spec.ts` "selecting a deep result auto-expands its full ancestor path" |
| No matches                      | Every set empty — a safe, explicit "No matching positions" state, never a crash or an unexplained blank canvas                                                  | "no matches produces an entirely empty result"                                                                                                         |
| Root match                      | No context needed at all                                                                                                                                        | "a root match needs no context at all"                                                                                                                 |
| Vacant-position match           | Fully supported — occupancy has no bearing on match/context eligibility                                                                                         | `organogram-search.test.ts` "a vacant position is still searchable by title and code"                                                                  |
| Planned-position match          | Subject to the "Show planned" toggle exactly like Phase 8's base visibility rule; when shown, participates in match/context normally                            | `organogram-search.test.ts` "excludes/includes planned positions"                                                                                      |

Full Company View (no search/filter/focus active) is unaffected — it renders exactly as Phase 8 always has. Filtering in Full View **restricts the rendered node set** to match+context (not merely highlight/dim over an unchanged full graph) — chosen because it gives a genuinely useful "show me only X" capability, while the explicit "No matching positions" empty state (rather than a silently-empty canvas) satisfies "must not accidentally hide the entire company without explanation."

## 7. Focus modes

**Full Company** — Phase 8's existing view, enhanced with search-result highlighting and filter-driven restriction.

**Position Focus** — the selected position (the sole match) + its complete ancestor path to root (context) + its descendants down to a chosen depth (rendered normally, not dimmed — they're the actual subject of the focus, not incidental context). Depth options: Direct Reports Only (1), Two Levels (2, the default), Three Levels (3), All Descendants.

**Department Focus** — every position whose own `departmentId` is the selected department (matches; membership is never inferred) + each match's ancestor chain (context) — this is exactly how a cross-department manager position correctly appears, labeled Context, never re-attributed to the focused department.

Entry points into a Focus mode: a search-result selection (→ Position Focus), the Details Panel's "Focus on this position" / "Focus on this department" buttons, or a deep link. "Full Company View" always returns from either Focus mode without discarding the current filters.

## 8. URL-state contract

| Param         | Values                                                                     | Default  | Notes                                  |
| ------------- | -------------------------------------------------------------------------- | -------- | -------------------------------------- |
| `view`        | `full` \| `position` \| `department`                                       | `full`   |                                        |
| `position`    | UUID                                                                       | —        | Only meaningful when `view=position`   |
| `department`  | UUID                                                                       | —        | Only meaningful when `view=department` |
| `depth`       | `1` \| `2` \| `3` \| `all`                                                 | `2`      | Only meaningful when `view=position`   |
| `departments` | comma-separated UUIDs                                                      | none     | Full-View department filter            |
| `levels`      | comma-separated integers                                                   | none     |                                        |
| `grades`      | comma-separated UUIDs, plus the literal `none` sentinel for "Not Assigned" | none     |                                        |
| `occupancy`   | `all` \| `occupied` \| `vacant`                                            | `all`    |                                        |
| `statuses`    | comma-separated from `PLANNED`/`ACTIVE`/`INACTIVE`                         | none     |                                        |
| `planned`     | `true` \| `false`                                                          | `true`   |                                        |
| `display`     | `visual` \| `outline`                                                      | `visual` |                                        |

**Never present:** employee names, work email, free-text search query, `companyId`, session/auth data. `position`/`department` are already-opaque UUIDs (never a name) — the same privacy posture Phase 7/8 already established for their own deep-link parameters.

**Validation** (`lib/domain/organogram-url-state.ts`, `lib/utils/search-params.ts`): every parameter has a safe default. An invalid or malformed value (bad UUID shape, out-of-range depth, unrecognized enum) falls back to its default rather than passing through — the same `parseEnumParam`/`parseUuidParam` pattern Phase 7 established, extended with `parseUuidListParam`/`parseIntListParam`/`parseBooleanParam` for the new multi-value fields. An oversized parameter (>2,000 raw characters) or an excessive entry count (>50 in a list) is rejected wholesale, not partially honored. Unknown parameters are silently ignored (`URLSearchParams` only ever reads the names this contract defines). A `position`/`department` id that doesn't resolve — including one from a completely different company — renders the same safe "not found" (or, for a company with zero positions at all, the more specific "No positions yet") empty state; the client never had that other company's data to look up in the first place, so cross-company existence is never revealed one way or the other.

## 9. Browser-history behavior

Discrete view changes — Focus mode switch, selected position/department, descendant depth, Visual/Outline toggle — call `history.pushState` (a new, Back-able entry). Rapid, high-frequency changes — filter checkbox toggles, the planned-position toggle — call `history.replaceState` (no new history entry, so ticking several filters in a row never spams Back/Forward).

**Neither uses `next/navigation`'s `router.push`/`router.replace`.** That router re-invokes the server component tree (a real `requirePagePermission`/`requireActiveUser` database round-trip) on every call, since Next's App Router treats any navigation — including a searchParams-only change — as needing a fresh RSC payload. Nothing server-side reads these parameters at all (only this client component's own `useSearchParams()` does), so that round-trip is pure waste, and under real load it was slow enough to make rapid filter interactions flake in `e2e/organogram-search-and-focus.spec.ts`. `window.history.pushState`/`replaceState` integrate directly with Next's router and keep `useSearchParams()`/`usePathname()` in sync with zero server involvement — the officially documented pattern for exactly this case (Next's App Router "Shallow routing on the client" guide). See `docs/DECISIONS.md` for the full incident writeup.

## 10. Copy View Link

Serializes the current URL state (§8) to a query string, builds the full absolute URL client-side, and writes it to the clipboard via `navigator.clipboard.writeText`. Success/failure is shown inline ("Copied!" / "Copy failed") — a clipboard-permission denial never throws unhandled or silently does nothing.

## 11. Performance

In-memory `Set`/`Map` operations only — no network round-trip for search, filter, or focus computation. `lib/domain/organogram-search-and-focus-performance.test.ts` measures the pipeline against a synthetic ~1,050-position fixture (30 branches × 35 levels, mirroring Phase 7/8's own diagnostic fixture shape): search, filter matching, filtered-context computation, Position Focus, and Department Focus each completed in under 3ms in this environment — not claimed as a production SLA, a diagnostic guard against an accidental quadratic regression, matching Phase 7/8's own stated precedent for this kind of test.

## 12. Accessibility

Search is an ARIA combobox/listbox (`components/ui/combobox.tsx`, reused from Phase 4/5's Reports-To picker) — arrow-key navigation, `Escape` to close, an `aria-live` region announcing the result count. Filter controls are native, labeled checkboxes/radios inside a `Sheet` drawer (reused from `components/layout/mobile-nav.tsx`) — the same drawer serves every viewport rather than a separate desktop sidebar (a deliberate scope simplification, §14). Match/Context are distinguished by more than color — a text badge ("Match"/"Context") on every node, in both Visual and Outline View, plus reduced (never illegible) opacity for Context nodes.

## 13. Known implementation notes

- **A real ARIA bug in the shared `Combobox` primitive, found and fixed during this phase.** `role="listbox"` requires every child to be `role="option"` — the component's "no results" empty-state message was a plain `<li>` inside the listbox, which axe's `aria-required-children`/`listitem` rules correctly flag. Not a Phase 9 regression (the component predates this phase), but only actually exercised once Phase 9's search box became the first caller to render that empty state under an accessibility scan. Fixed by rendering the empty message as a `<p>` sibling instead of an invalid listbox child — benefits every other `Combobox` consumer (e.g. the Reports-To picker), not just this one.
- **The router-round-trip finding in §9** was the most significant defect found this phase — it didn't just affect one test, it would have made every filter interaction in production noticeably slower than necessary.

## 14. Known limitations

- The filter drawer uses one `Sheet`-based implementation for every viewport (mobile and desktop alike) rather than a persistent always-open desktop sidebar plus a separate mobile drawer. A deliberate scope simplification, not a defect — revisit only if user feedback specifically asks for a persistent desktop panel.
- `Position.location` is not a filter field (§1) — deferred, not implemented, per this phase's own explicit filter list.
- Employee code is not a search field (§1) — no approval exists on file, and the underlying contract deliberately doesn't carry it.
- Node centering on search-result selection uses React Flow's `setCenter` on the selected node's own computed position — precise, but a single click can only center one node at a time; there is no "highlight all matches simultaneously with a combined viewport fit" mode distinct from Position Focus's own natural framing.
