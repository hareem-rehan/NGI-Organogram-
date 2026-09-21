---
name: negative-test-design
description: Generate a phase-specific positive/negative scenario matrix before implementing production code for any feature in the Dynamic Organogram Manager project. Use at the start of every implementation phase (Phase 1 onward), before writing feature code, per CLAUDE.md's requirement to define scenarios before implementation.
---

# Negative Test Design

`CLAUDE.md` §1.6 requires positive and negative scenarios to be defined **before** implementation, not backfilled after. This skill produces that scenario matrix for the phase currently being started.

## Procedure

1. **Read the phase's scope.** From `docs/IMPLEMENTATION_PLAN.md`, take the current phase's Features, Business Rules Affected, and the Positive/Negative Scenarios already listed there as a starting point — not the final list. Also check `docs/NEGATIVE_SCENARIOS.md` for the relevant domain sections (Departments, Positions, Employees, Hierarchy Movement, Authentication, Authorization, Search, Filters, CSV Import, Export, Audit Logs, Database Transactions, Concurrent Actions, Empty States, Large Datasets, Dependency Failures) and pull in anything applicable that the plan's phase entry didn't already restate.

2. **Evaluate every category below against this phase's actual features.** For each category, decide: applicable (write scenario rows) or not applicable (state why, one line — never silently drop a category):
   - Invalid input
   - Missing input
   - Boundary values (min/max length, zero, very large numbers, deepest hierarchy level, etc.)
   - Duplicate requests (double-submission, idempotency)
   - Unauthorized access (no session / wrong session)
   - Forbidden actions (authenticated but wrong role)
   - Invalid state transitions
   - Dependency failures (DB down, auth provider down, etc.)
   - Database failures (constraint violations, connection errors)
   - Transaction rollback (mid-operation failure)
   - Concurrent requests (two actors racing on the same or overlapping data)
   - Empty data (nothing exists yet)
   - Large data (representative and boundary scale, per `docs/DECISIONS.md` P7)
   - Accessibility failure (keyboard trap, missing label, color-only signal)
   - Confidential-data exposure (a role seeing a field it shouldn't, per `docs/DECISIONS.md` P1)

3. **Build the matrix.** For every scenario identified, produce a row with:

   | Scenario | Positive/Negative | Preconditions | Action | Expected Result | Test Layer | Automated/Manual | Status |
   | -------- | ----------------- | ------------- | ------ | --------------- | ---------- | ---------------- | ------ |
   - **Test Layer**: one of Unit, Integration, Component, E2E, per `docs/TEST_STRATEGY.md`'s definitions of what belongs where.
   - **Automated/Manual**: default to Automated. Mark Manual only when automation is genuinely impractical (e.g. certain visual/canvas accessibility spot-checks per `docs/TEST_STRATEGY.md` §9) — and say why in the row or a footnote.
   - **Status**: Not Started / In Progress / Done — updated as implementation proceeds, so the matrix stays a living artifact through the phase, not a one-time checklist.

4. **Cross-check against the hierarchy invariants** (if this phase touches positions, levels, reporting, or assignment) using `.claude/skills/organogram-hierarchy-safety/SKILL.md`'s 12 invariants — every invariant relevant to this phase's features needs at least one row.

5. **Cross-check against the Role–Permission Matrix** (if this phase adds or touches any mutating capability) — every role×capability cell relevant to this phase needs an allow-path and deny-path row.

6. **Hand the matrix to implementation.** Production code for this phase is written against this matrix — a feature isn't "done" until every Automated row in the matrix has a passing test, and every Manual row has been actually performed and recorded (not assumed).

7. **Feed into the phase report.** The completed matrix (with final Status column) is what `docs/phase-reports/phase-N.md`'s "Scenario Matrix" section references or embeds.

## What this skill must never do

- Never mark a category "not applicable" without a stated reason.
- Never generate a matrix so generic it could apply to any phase — every row should reference this phase's actual features, fields, and roles, not a template placeholder.
- Never let the matrix be produced _after_ the code as a rationalization — if implementation is already underway, that's a process miss to flag, not something to paper over with a matrix written to match what was already built.
