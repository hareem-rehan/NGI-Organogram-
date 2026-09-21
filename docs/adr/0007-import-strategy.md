# ADR-0007: Two-phase CSV import (validate+preview, then commit)

## Status

Accepted (Phase 0)

## Context

Business rule (proposal §10, `docs/PROJECT_SPEC.md` FR-I1/FR-I2) requires row-level validation with a preview and explicit confirmation before any import data is saved, and requires that a batch with unresolved blocking errors doesn't commit. Import rows can reference each other (a position's Reports-To code may be another row in the same file), so validation must consider the whole file, not just one row in isolation.

## Decision

Implement CSV import as two distinct, separately-invokable operations in `import.service.ts`:

1. **`parse(file)`** — parses the file and validates every row (field-level Zod validation plus cross-row checks: duplicate codes within the file, duplicate codes against existing data, resolvable Reports-To codes either in the file or already in the DB, cycle detection across the proposed resulting graph). Returns a structured preview (valid rows, invalid rows with reasons) and **writes nothing to the database**.
2. **`commit(acceptedRows, userId)`** — takes the user-confirmed set of rows (all valid rows, or a user-narrowed subset excluding rows they chose to skip) and applies them via the existing `department.service`/`position.service`/`employee.service` create/update paths, inside one transaction (ADR-0005).

## Rationale

- Separating parse/validate from commit is the only way to give HR a genuine preview-before-commit experience (FR-I1) — a single combined "import" call can't show errors before writing.
- Reusing the same per-entity service methods for commit (rather than a separate bulk-insert code path) guarantees import-created data obeys exactly the same business rules as manually-created data — no parallel, potentially-divergent validation logic to maintain.
- Cross-row validation (shuffled parent rows, where a child row appears before its parent in file order) must happen against the _whole proposed file_, not row-by-row streaming validation, or a valid file could be incorrectly rejected based on row order alone.

## Alternatives Considered

- **Direct row-by-row insert with rollback-on-first-error:** rejected — doesn't give a preview, and a late failure would require rolling back partial work anyway; strictly worse than validate-then-commit for both UX and correctness.
- **Background/async job queue for large imports:** deferred — no evidence yet that synchronous processing at the ~2,000-row scale (`docs/DECISIONS.md` P7) requires it; if Phase 10 measurement shows otherwise, this ADR should be revisited rather than silently working around it.

## Consequences

- The import preview UI needs to clearly represent per-row errors and let the user exclude specific rows before commit (Phase 10 deliverable).
- Row order in the source file must not affect validation correctness — the parser needs to build the full proposed graph before evaluating Reports-To resolvability and cycles, per the "shuffled parent rows" negative scenario in `docs/NEGATIVE_SCENARIOS.md`.
