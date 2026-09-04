# ADR-0001: Next.js App Router as the application framework

## Status

Accepted (Phase 0)

## Context

The repository is greenfield — no existing frontend/backend framework to preserve. The application needs server-rendered pages for an internal business tool, a server-enforced API surface (business rules must never live only in the client — `docs/PROJECT_SPEC.md` §7 rule 12), and a single deployable unit to keep operations simple for an internal HR tool.

## Decision

Use Next.js with the App Router, TypeScript throughout.

## Rationale

- Server Components + Server Actions give a natural place to put authorization and validation that cannot be bypassed by a modified client request, without standing up a separate backend service.
- File-system routing maps cleanly onto the MVP's view structure (Overview, Full Organogram, Focus View, per-entity admin screens).
- Single deployable (one Node.js process) matches an internal-tool's operational simplicity needs (§15 in `docs/ARCHITECTURE.md`).
- Large ecosystem compatibility with the rest of the chosen stack (Prisma, Auth.js, shadcn/ui, React Flow all have first-class Next.js support/examples).

## Alternatives Considered

- **Separate SPA (Vite/React) + REST/GraphQL API service:** more moving parts to deploy and secure for no MVP benefit; rejected for this scope.
- **Remix:** comparable capabilities, but smaller overlap with the rest of the chosen stack's documented integration patterns; no strong reason to prefer it over Next.js here.

## Consequences

- All business logic must be deliberately kept out of Server/Client Components and pushed into `server/services` (see `docs/ARCHITECTURE.md` §4–5) — App Router makes it easy to accidentally inline logic in a Server Action, so this needs to be an explicit code-review discipline, reinforced by the `phase-quality-gate` skill.
- Ties the project to Node.js hosting; acceptable given no alternative runtime was requested.
