---
name: organogram-hierarchy-safety
description: Apply the organizational-hierarchy invariants whenever positions, organizational levels, reporting relationships, employee assignments, or CSV import touch the org structure in the Dynamic Organogram Manager project. Use before and after implementing any code that reads or writes Position.reportsToPositionId, Position.organizationalLevel, or Employee-to-Position assignment.
---

# Organogram Hierarchy Safety

The organogram's entire value proposition depends on these invariants holding at all times, in all code paths — manual entry, CSV import, and any future path. This skill exists because a single missed invariant (e.g. an import path that skips cycle detection) silently corrupts the hierarchy in a way that's hard to notice until HR reports something wrong on the chart.

## Invariants to enforce

1. **Root level is 1.** Exactly one position has `reportsToPositionId = null`, and it has `organizationalLevel = 1`.
2. **Child level equals parent level + 1.** Always computed, never client-supplied or hand-edited.
3. **No self-reporting.** A position's `reportsToPositionId` must never equal its own id.
4. **No direct cycle.** A→B and B→A simultaneously is rejected.
5. **No indirect cycle.** A→B→C→...→A at any depth is rejected — check the full ancestor chain of the proposed new parent, not just its immediate parent.
6. **No move beneath a descendant.** A position's new `reportsToPositionId` must not be found anywhere in its own current descendant subtree.
7. **Department headings do not affect levels.** Department is a grouping/color attribute on a Position, never a node in the reporting chain itself.
8. **Subtree moves recalculate all descendants.** Moving position P recalculates P's level and the level of every position in P's descendant subtree, not just P itself.
9. **Moves are atomic.** All of the above writes happen inside one database transaction ([ADR-0005](../../../docs/adr/0005-transaction-strategy.md)).
10. **Failed moves roll back completely.** Any failure partway through leaves the database exactly as it was before the operation started — verified by test, not assumed.
11. **Removing an employee does not remove the position.** Deactivating/transferring/unassigning an employee sets the position to `VACANT`; the position row itself, its code, its place in the hierarchy, and its history are untouched.
12. **Concurrent changes do not leave an inconsistent hierarchy.** Two overlapping mutations (e.g. two users moving branches that intersect) must not both apply and leave levels/relationships in a state that violates invariants 1–8. Detect and reject the conflicting second write rather than silently merging.

## When to apply this skill

- Before implementing any service method in `server/services/hierarchy.service.ts` (or any other code that writes `reportsToPositionId`/`organizationalLevel`/employee↔position links).
- Before implementing the CSV import commit path ([ADR-0007](../../../docs/adr/0007-import-strategy.md)) — import must reuse `hierarchy.service`, not a parallel implementation, specifically so these invariants can't diverge between manual entry and bulk import.
- Before implementing employee assignment/removal logic.
- After any change to the above code paths, as a review pass — re-check each invariant against what was actually written, not what was intended.

## Procedure

1. **Identify every code path that can reach a hierarchy-affecting write.** There should be exactly one: `hierarchy.service.ts` for `reportsToPositionId`/`organizationalLevel`, and `employee.service.ts` for assignment (which itself should delegate to `hierarchy.service` or shared logic for the position-status side-effect). If a second, independent path exists (e.g. CSV import writing positions directly instead of going through the shared service), that is itself a defect — flag it.

2. **Walk each invariant against the implementation.** For each of the 12 invariants above, find the specific line(s) of code responsible for enforcing it and confirm the logic is actually correct — not merely present. Common failure modes to check for specifically:
   - Cycle detection that only checks the immediate parent, not the full ancestor chain (misses indirect cycles).
   - Level recalculation that updates the moved position but not its descendants, or that walks descendants but stops at the first level instead of recursing/iterating the full subtree.
   - A transaction boundary that doesn't actually wrap every write (e.g. the audit log write happens outside the transaction — see [ADR-0008](../../../docs/adr/0008-audit-strategy.md)).
   - Employee removal logic that touches the Position row's identity/code instead of only its assignment link and derived status.

3. **Require regression tests for every invariant this change affects.** At minimum: a positive test proving the operation works correctly, and a negative test proving each relevant invariant violation is rejected. Reuse/extend the scenarios already cataloged in `docs/NEGATIVE_SCENARIOS.md` under "Positions," "Hierarchy Movement," and "Organizational Levels" rather than inventing new ad hoc ones. Concurrency (invariant 12) requires a test that actually simulates overlapping writes (e.g. two transactions racing), not just sequential calls.

4. **Confirm CSV import doesn't bypass any of this.** If the current phase touches import, explicitly verify the import commit path calls the same `hierarchy.service`/`employee.service` functions as manual entry — trace the actual call, don't assume based on naming.

5. **Report findings** as part of the current phase's quality gate (`phase-quality-gate` skill) — a violated invariant, or an invariant with no corresponding regression test, is a blocking finding, not a note for later.

## What this skill must never do

- Never treat "the happy path works" as sufficient evidence an invariant holds — every invariant needs its negative-case test.
- Never let CSV import or any future bulk-write path implement its own copy of hierarchy validation logic instead of reusing `hierarchy.service`.
- Never accept a client-supplied `organizationalLevel` value — it is always server-computed.
