---
name: phase-quality-gate
description: Verify a development phase against its acceptance criteria before marking it complete. Run this at the end of every implementation phase (Phase 1 onward) in the Dynamic Organogram Manager project, before writing the phase report or telling the user a phase is done.
---

# Phase Quality Gate

Use this skill at the end of every bounded phase from `docs/IMPLEMENTATION_PLAN.md`, before the phase is reported as complete. Its output is one of three verdicts: **PASS**, **PASS WITH NON-BLOCKING ITEMS**, or **FAIL**. A phase is not complete until this returns PASS or PASS WITH NON-BLOCKING ITEMS — do not proceed to the next phase on a FAIL, and do not let the user believe a phase is done without running this.

## Procedure

1. **Read the phase's acceptance criteria.** Open `docs/IMPLEMENTATION_PLAN.md` and locate the current phase's Objective, Features, Business Rules Affected, Acceptance Criteria, and Required Verification Commands. Also re-read `CLAUDE.md` in full — its standing rules apply to every phase.

2. **Confirm positive and negative scenario coverage.** Cross-reference the phase's scenario matrix (produced via the `negative-test-design` skill before implementation started) against what was actually implemented. For every scenario relevant to this phase:
   - Confirm a test exists and actually exercises the scenario (read the test, don't just trust its name).
   - Confirm categories marked "not applicable" have a stated reason, not a silent omission.
   - Flag any scenario from `docs/NEGATIVE_SCENARIOS.md` relevant to this phase that has no corresponding test and no documented reason why not.

3. **Run the verification commands**, all of them, and capture real output:
   - Lint
   - Type checking
   - Unit tests
   - Integration tests
   - Relevant component tests
   - Relevant E2E tests
   - Production build

   Do not report a command as passing without having actually run it in this session. Do not summarize output from memory.

4. **Validate migrations where applicable.** If this phase added/changed a Prisma migration: confirm it applies cleanly to a fresh database, confirm any destructive change (drop/rename/type-narrowing) is called out explicitly, and confirm seed/fixture data survives it where relevant.

5. **Verify rollback behavior where applicable.** If this phase touches hierarchy mutations, employee assignment, or CSV import commit (anything wrapped in a transaction per [ADR-0005](../../../docs/adr/0005-transaction-strategy.md)): confirm there is an actual test that simulates a mid-operation failure and asserts the database is left completely unchanged — not just that the happy path works.

6. **Verify authorization where applicable.** If this phase adds or touches any mutating capability: confirm every relevant cell of the Role–Permission Matrix (`docs/PROJECT_SPEC.md` §10) has both an allow-path and deny-path test, and that the check happens server-side (at the API/server-action layer), not only in a policy function nothing calls.

7. **Confirm tests were not disabled or weakened to force a pass.** Diff the test files touched in this phase (or read them fresh) and check for: skipped/commented-out tests, loosened assertions, deleted tests without a documented reason, or mocks introduced specifically to avoid exercising real hierarchy/transaction/authorization logic where `docs/TEST_STRATEGY.md` §15 requires the real thing. Any of these found without an explicit, reasoned justification in the phase report is a blocking finding — flag it and do not let it pass silently.

8. **Create or update the phase report** at `docs/phase-reports/phase-N.md` using the structure in `docs/phase-reports/README.md`. Every section must be filled with real evidence (actual commands, actual output, actual file list) — not placeholders.

9. **Determine the verdict:**
   - **FAIL** — any blocking category from `docs/TEST_STRATEGY.md` §17 failed: lint/typecheck/build error, any failing unit/integration/component/permission test, migration failure, any hierarchy-invariant/rollback/authorization/confidential-data test failure, or a test found to be disabled/weakened without justification. Do not proceed to the next phase.
   - **PASS WITH NON-BLOCKING ITEMS** — all blocking checks pass, but there are documented, non-blocking items per `docs/TEST_STRATEGY.md` §17 (e.g. isolated E2E flakiness, a deferred-feature accessibility note). List them explicitly in the phase report.
   - **PASS** — all blocking checks pass and there are no unresolved non-blocking items worth flagging.

10. **Prevent progression on FAIL.** If the verdict is FAIL, stop. Report the specific failures to the user, fix them, and re-run this gate — do not move to the next phase, and do not tell the user the phase is complete.

## What this skill must never do

- Never mark a phase complete because "the code looks right" without actually running the verification commands.
- Never treat a category as satisfied because a similar-sounding test exists elsewhere — check the test actually covers this phase's specific scenario.
- Never suggest weakening, skipping, or deleting a failing test as the fix — the fix is either the code or, if the test is provably wrong, an explicit correction with justification recorded in the phase report (`CLAUDE.md` §1.14).
- Never claim PASS without the phase report containing the actual command output that justifies it (`CLAUDE.md` §1.15).
