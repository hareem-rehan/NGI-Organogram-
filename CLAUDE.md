# CLAUDE.md — Dynamic Organogram Manager

Permanent operating instructions for every Claude Code session working in this repository. These rules apply to all future phases and cannot be superseded by convenience, time pressure, or an ambiguous user request. If an instruction here conflicts with something in a single prompt, follow this file and ask.

## 0. What this project is

An internal web application that lets non-technical HR users independently manage Departments, Positions, Employees, Vacancies and primary reporting relationships, and that **automatically generates** the company organogram from that structured data — HR never manually positions chart nodes.

Source documents (read before any phase):

- [docs/source/Dynamic_Organogram_Solution_Proposal.docx](docs/source/Dynamic_Organogram_Solution_Proposal.docx) — original business proposal. **Status inside the document is "For discussion and requirements confirmation" — it is a discovery draft, not a signed-off spec.** Do not treat it as fully approved; cross-check against [docs/DECISIONS.md](docs/DECISIONS.md).
- [docs/PROJECT_SPEC.md](docs/PROJECT_SPEC.md) — the working product specification derived from the proposal.
- [docs/DECISIONS.md](docs/DECISIONS.md) — the single source of truth for what is confirmed vs. still open. **Check this before assuming any business rule.**

## 1. Standing rules for every session

1. **Read project documents before every phase.** At minimum: this file, `docs/DECISIONS.md`, `docs/PROJECT_SPEC.md`, `docs/IMPLEMENTATION_PLAN.md` (the phase you're starting), and `docs/ARCHITECTURE.md`. Do not rely on memory of a prior session.
2. **Preserve existing conventions and completed functionality.** Do not rewrite, restructure, or "improve" working code from a prior phase unless the current phase's objective requires it. If you believe a prior decision was wrong, raise it — don't silently override it.
3. **Implement one bounded phase at a time**, per `docs/IMPLEMENTATION_PLAN.md`. Do not pull work forward from a later phase, and do not leave a phase partially done and move on.
4. **Do not implement deferred features.** See "MVP Exclusions" in `docs/PROJECT_SPEC.md`. If a deferred feature seems necessary to finish a phase, stop and say so — it usually means the phase boundary needs adjusting, not that the exclusion should be ignored.
5. **Do not silently assume unresolved HR decisions.** Anything listed under "Pending HR Decisions" or "Assumptions Requiring Confirmation" in `docs/DECISIONS.md` must be implemented behind the safest reversible default, called out in the phase report, and never presented as final/confirmed behavior.
6. **Define positive and negative scenarios before implementation.** Use the `negative-test-design` skill/workflow (see §3) to build the scenario matrix before writing production code for any feature.
7. **Add tests in the same phase as production code.** No "tests in a later phase" — a phase that adds behavior without tests for that behavior is incomplete.
8. **Enforce business rules and permissions server-side, not only in the UI.** UI-only validation or role gating is a defect, not a shortcut. Every mutation must be re-validated and re-authorized on the server regardless of what the client sent.
9. **Use database transactions wherever a partial write could corrupt data** — hierarchy moves, level recalculation, CSV import commits, employee↔position reassignment. See the `organogram-hierarchy-safety` skill.
10. **Do not leave placeholder buttons or fake functionality.** If a control is visible, it must work end-to-end and be covered by tests, or it must not exist yet.
11. **Do not hard-code production credentials or confidential data.** No real employee data, secrets, tokens, or connection strings in source, fixtures, seeds, or docs. Use synthetic fixture data only.
12. **Run the complete phase quality gate** (see `phase-quality-gate` skill) before declaring a phase complete.
13. **Update documentation and phase reports** as part of the phase, not as an afterthought — `docs/DECISIONS.md`, `docs/DATA_DICTIONARY.md`, `docs/ARCHITECTURE.md`, and `docs/phase-reports/phase-N.md` all need to reflect what actually shipped.
14. **Never weaken or delete a valid test merely to obtain a passing result.** If a test fails, fix the code or, if the test itself is provably wrong, fix the test and say so explicitly in the phase report — do not skip, comment out, loosen assertions on, or delete it silently.
15. **Never claim completion without verification evidence.** "Done" requires the actual command output (lint, typecheck, tests, build) referenced in the phase report, not an assertion that it "should work."

## 2. Non-negotiable business invariants

These come from `docs/PROJECT_SPEC.md` §Business Rules and must hold after every change that touches the hierarchy:

- Position and Employee are separate entities; removing/transferring an employee never deletes the position.
- Every active position has exactly one primary Reports-To position, except the root, which has none.
- Root position organizational level = 1. Child level = parent level + 1, always system-calculated, never hand-edited.
- Department headings / visual grouping do not count as organizational levels.
- Organizational Level (system-calculated) and Job Grade (HR-maintained) are independent fields — never derive one from the other.
- No self-reporting, no direct or indirect reporting cycles, no moving a position beneath its own descendant.
- No duplicate position codes or employee codes (case-insensitive).
- Moving a position is atomic: update parent, recalculate the position's level and every descendant's level, all inside one DB transaction, full rollback on any failure.

Full detail: `docs/PROJECT_SPEC.md`, `docs/DATA_DICTIONARY.md`, and the `organogram-hierarchy-safety` skill.

## 3. Project skills / workflows

Project-local skills live under `.claude/skills/` and are invoked automatically or via the `Skill` tool where applicable:

- **`phase-quality-gate`** — run before marking any phase complete. Verifies acceptance criteria, scenario coverage, lint/typecheck/tests/build, migrations, rollback behavior, and authorization; produces a PASS / PASS WITH NON-BLOCKING ITEMS / FAIL verdict.
- **`organogram-hierarchy-safety`** — apply whenever a change touches positions, levels, reporting relationships, assignments, or import. Encodes the hierarchy invariants in §2 and the regression tests they require.
- **`negative-test-design`** — run before implementing any feature to produce the phase-specific negative-scenario matrix (invalid input, unauthorized access, concurrency, rollback, empty/large data, etc.) and map each scenario to a test layer.

## 4. Where things live

| Path                          | Purpose                                                                     |
| ----------------------------- | --------------------------------------------------------------------------- |
| `docs/PROJECT_SPEC.md`        | Product spec: scope, rules, roles, acceptance criteria                      |
| `docs/ARCHITECTURE.md`        | Technical architecture, stack, data flow                                    |
| `docs/DECISIONS.md`           | Confirmed / pending / assumed decisions — check before assuming anything    |
| `docs/DATA_DICTIONARY.md`     | Field-level entity definitions                                              |
| `docs/IMPLEMENTATION_PLAN.md` | Phase-by-phase build plan (Phase 0–14)                                      |
| `docs/TEST_STRATEGY.md`       | Test layers, tooling, CI gates                                              |
| `docs/NEGATIVE_SCENARIOS.md`  | Master negative/boundary scenario catalog                                   |
| `docs/adr/`                   | Architecture decision records                                               |
| `docs/phase-reports/`         | One report per completed phase (template in `docs/phase-reports/README.md`) |
| `.claude/skills/`             | Project-local Claude Code skills described above                            |

## 5. When to ask vs. when to default

Ask the user only when the answer would materially change database design, authentication/authorization design, security, data confidentiality, MVP scope, destructive behavior, or requires significant implementation effort to reverse.

For everything else: choose the safest reversible default, record it in `docs/DECISIONS.md` under "Assumptions Requiring Confirmation," and keep moving. Do not let an open question block a whole phase if a safe default exists.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
