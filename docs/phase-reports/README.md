# Phase Report Standard

Every phase in `docs/IMPLEMENTATION_PLAN.md` produces one report at `docs/phase-reports/phase-N.md` (e.g. `phase-2.md`) using the structure below. A phase is not complete until its report exists and is filled in with real evidence — not placeholders, not "should be fine."

## Template

```markdown
# Phase N Report — <Phase Title>

Date: <YYYY-MM-DD>

## Phase Objective

<Copied/summarized from docs/IMPLEMENTATION_PLAN.md for this phase.>

## Scope

<What was actually built in this phase. Call out anything intentionally deferred to a later phase and why.>

## Acceptance Criteria

<List each criterion from the plan and its status: met / not met / partially met with explanation.>

## Business Rules

<Which numbered business rules (docs/PROJECT_SPEC.md §7) this phase touches, and confirmation each still holds.>

## Scenario Matrix

<Link to or embed the positive/negative scenario matrix used for this phase (produced via the negative-test-design skill before implementation). Include status (automated/manual/not-applicable-with-reason) per scenario.>

## Files Changed

<List of files added/modified/removed, grouped logically — not a raw diff dump.>

## Migrations

<Any Prisma migrations added this phase: name, what changed, whether it's destructive, rollback approach. "None" if not applicable.>

## Commands Executed

<Every verification command actually run, verbatim, e.g.:

- `npm run lint`
- `npm run typecheck`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:e2e`
- `npm run build`>

## Test Results

<Actual output summary for each command above — pass/fail counts, not "all tests pass" without evidence. Paste the relevant summary lines.>

## Failures Discovered

<Any test/build/lint failures hit during the phase, even if later fixed. Do not omit — this is part of the evidence trail.>

## Fixes Applied

<What was changed in response to each failure above.>

## Regression Results

<Confirmation that prior phases' test suites still pass. Reference the command/output.>

## Coverage Gaps

<Any scenario from docs/NEGATIVE_SCENARIOS.md relevant to this phase that is NOT yet automated, with a reason (e.g. "deferred to Phase 13 hardening") — never silently omitted.>

## Accessibility Findings

<Automated audit results + manual spot-check notes, if this phase touches UI. "Not applicable — no UI in this phase" if genuinely not applicable.>

## Security Findings

<Any issues found (auth bypass attempts, injection attempts, confidential-field leakage checks) and their resolution status.>

## Performance Findings

<Any measurements taken against docs/PROJECT_SPEC.md §14 targets, if this phase is performance-relevant.>

## Known Limitations

<Anything intentionally left incomplete or deferred, and why — should map to explicit non-goals in the plan or to docs/DECISIONS.md.>

## Decisions Added

<Any new entries added to docs/DECISIONS.md as a result of this phase's work — link them.>

## Gate Result

<PASS / PASS WITH NON-BLOCKING ITEMS / FAIL — from the phase-quality-gate skill. If not PASS, this phase is not complete and the plan does not proceed.>

## Recommended Next Phase

<Confirmation of the next phase per docs/IMPLEMENTATION_PLAN.md, or a note if this report is recommending a re-scope.>
```

## Rules for Filling This Out

- Every section must be filled in — "N/A" is acceptable only with a one-line reason, never a blank section.
- "Test Results" and "Commands Executed" must reflect commands that were actually run in this session, with real output. Do not write test results from memory or assumption (`CLAUDE.md` §1.15).
- If a test was weakened or removed for any reason, that must appear explicitly under "Fixes Applied" with justification — never silently (`CLAUDE.md` §1.14).
- A report with Gate Result other than PASS or PASS WITH NON-BLOCKING ITEMS means the phase is not done, regardless of how much code was written.
