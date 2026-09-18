# Architecture — Dynamic Organogram Manager

This describes the recommended technical architecture for a **greenfield** build (the repository contained only `README.md` at the start of Phase 0 — no existing stack to preserve). Rationale for each major choice is in `docs/adr/`.

## 1. Technology Stack

| Layer                  | Choice                                                                | Why (see ADR)                                                                                                                                             |
| ---------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend/app framework | Next.js (App Router), TypeScript                                      | Server + client components in one framework, built-in server actions/route handlers for a server-enforced API — [ADR-0001](adr/0001-nextjs-app-router.md) |
| Styling / components   | Tailwind CSS, shadcn/ui                                               | Fast, consistent, accessible-by-default component primitives for HR-facing forms/tables                                                                   |
| Database               | PostgreSQL                                                            | Relational integrity for hierarchy constraints (FKs, transactions) — [ADR-0002](adr/0002-postgresql-prisma.md)                                            |
| ORM                    | Prisma                                                                | Type-safe queries, migrations, transaction API — [ADR-0002](adr/0002-postgresql-prisma.md)                                                                |
| Validation             | Zod                                                                   | Shared schema between client forms and server actions, single source of truth for validation rules                                                        |
| Forms                  | React Hook Form + Zod resolver                                        | Performant controlled forms with the shared validation schemas                                                                                            |
| Organogram canvas      | React Flow                                                            | Interactive node/edge canvas with pan/zoom/expand primitives — [ADR-0004](adr/0004-reactflow-elk.md)                                                      |
| Organogram layout      | ELK.js (layered algorithm)                                            | Automatic, deterministic hierarchical layout from graph data — no manual node placement — [ADR-0004](adr/0004-reactflow-elk.md)                           |
| Auth                   | Auth.js (NextAuth), credentials provider for MVP                      | Adapter-based; SSO/OIDC addable later without a rewrite — [ADR-0003](adr/0003-authjs.md)                                                                  |
| Testing                | Vitest, React Testing Library, Playwright, Postgres integration tests | Layered coverage matching `docs/TEST_STRATEGY.md` — [ADR-0006](adr/0006-testing-tools.md)                                                                 |

## 2. Application Layers

```
┌─────────────────────────────────────────────────────────────┐
│ Routes / Pages (app/)                                        │
│  - Company Overview, Full Organogram, Focus View, admin CRUD │
├─────────────────────────────────────────────────────────────┤
│ UI Components (components/)                                  │
│  - Presentational + shadcn/ui primitives, org-chart widgets   │
├─────────────────────────────────────────────────────────────┤
│ Feature Modules (features/)                                  │
│  - departments, positions, employees, hierarchy, import,      │
│    export, audit, users — each owns its forms + hooks         │
├─────────────────────────────────────────────────────────────┤
│ Domain / Service Layer (server/services/)                     │
│  - Business rules, hierarchy invariants, transactions          │
├─────────────────────────────────────────────────────────────┤
│ Authorization Policies (server/policies/)                     │
│  - Role→capability checks, invoked by every service method     │
├─────────────────────────────────────────────────────────────┤
│ Repository / Data Access (server/repositories/)                │
│  - Prisma queries only; no business logic here                 │
├─────────────────────────────────────────────────────────────┤
│ Database (PostgreSQL via Prisma schema + migrations)           │
└─────────────────────────────────────────────────────────────┘
```

Each layer only calls the layer directly below it. UI components never call repositories directly, and route handlers/server actions never contain business logic inline — they call a service.

## 3. Frontend Structure

```
app/
  (auth)/login/                    Login page
  (dashboard)/overview/            Company Overview
  (dashboard)/organogram/          Full Organogram
  (dashboard)/organogram/focus/    Focus View
  (dashboard)/departments/         Department management
  (dashboard)/positions/           Position management
  (dashboard)/employees/           Employee management
  (dashboard)/vacancies/           Vacant position management
  (dashboard)/import/              CSV import wizard
  (dashboard)/audit/               Audit history
  (dashboard)/users/               User management (Super Admin)
  api/ or server actions           Route handlers for anything not covered by server actions
components/
  ui/                              shadcn/ui primitives (generated, lightly wrapped)
  organogram/                      OrgNode, OrgEdge, Canvas, Controls, Minimap wrappers
  layout/                          Shell, nav, role-aware menu
features/
  departments/ positions/ employees/ hierarchy/ import/ export/ audit/ users/
    components/ hooks/ schemas/ actions.ts
```

**Responsibilities:**

- `app/` — routing, layout composition, data fetching entry points only.
- `components/ui/` — generic, feature-agnostic primitives.
- `components/organogram/` — rendering-only components that take already-computed graph data (positions + layout) as props; they do not fetch or compute hierarchy themselves.
- `features/*` — everything specific to one domain area: its forms, its Zod schemas (client-usable subset), its server actions that call into `server/services`.

## 4. Backend / Server Design

Next.js Server Actions (and route handlers where a plain REST-style endpoint is clearer, e.g. CSV upload, export) are the only entry points into the domain layer. They are responsible for:

1. Authenticating the request (session lookup).
2. Authorizing the action (calling `server/policies`).
3. Validating input (Zod schema — the same schema, or a superset, of what the client used).
4. Delegating to `server/services`.
5. Returning a typed result or a typed error — never leaking a raw DB/Prisma error to the client.

Server actions/route handlers contain **no** business logic themselves — that guarantees rule 12 (server-side enforcement) isn't accidentally satisfied only in one entry point while another bypasses it.

## 5. Domain / Service Layer

```
server/services/
  department.service.ts
  position.service.ts       # create/update position, status transitions
  hierarchy.service.ts       # move position, level recalculation, cycle detection
  employee.service.ts        # create/update employee, assignment logic
  organogram.service.ts      # builds the graph payload for a given scope (company/dept/focus)
  import.service.ts          # CSV parse -> validate -> preview -> commit
  export.service.ts          # builds export-ready payloads (PDF/PNG data)
  audit.service.ts           # writes AuditLog entries, always inside the caller's transaction
  auth/rbac policies live in server/policies/, not here
```

`hierarchy.service.ts` is the single place that implements the hierarchy invariants in `CLAUDE.md` §2 (cycle detection, level recalculation, atomic move). Every other service that touches `reportsToPositionId` goes through it — there is exactly one code path that can change the hierarchy shape, so the invariants can't be violated by a second, forgotten call site. This is elaborated in `.claude/skills/organogram-hierarchy-safety/SKILL.md`.

## 6. Database Access Layer

`server/repositories/` wraps Prisma Client calls and is the only place `prisma.*` is called directly. Rules:

- Repositories return plain data, never Prisma-specific types, to keep services decoupled from the ORM.
- Any repository method that is part of a multi-step hierarchy mutation accepts an optional transaction client (`Prisma.TransactionClient`) so callers can compose multiple repository calls into one `prisma.$transaction(...)` — see [ADR-0005](adr/0005-transaction-strategy.md).
- No repository method silently catches and swallows a DB error; errors propagate to the service layer, which maps them to typed domain errors.

## 7. Authentication Design

- Auth.js (NextAuth) with a **credentials provider** for MVP (email + password, admin-provisioned accounts — no public self-signup), stored behind an adapter interface so an OIDC/SSO provider can be added later without changing consumers of the session (pending P8 in `docs/DECISIONS.md`).
- Sessions are server-side (database or encrypted JWT session per Auth.js defaults) and read on every server action/route handler — the client never determines its own role.
- Passwords are hashed (bcrypt/argon2) before storage; plaintext is never logged or persisted (`CLAUDE.md` §1.11).

## 8. Authorization Design

- `server/policies/` defines one policy function per capability (e.g. `canMovePosition(user, position)`, `canViewField(user, field)`), each taking the authenticated user's role and the target resource.
- Every service method that mutates or returns sensitive data calls the relevant policy function first; a denial throws a typed `ForbiddenError` that server actions translate into a 403-equivalent response.
- The Role–Permission Matrix in `docs/PROJECT_SPEC.md` §10 is the source of truth these policies implement; a policy test exists for every cell of that matrix (see `docs/TEST_STRATEGY.md`).
- Field-level visibility (confidential fields, pending P1) is enforced by the service layer shaping its return payload per-role — never by the client hiding fields it already received.

## 9. Organogram Layout Design

1. `organogram.service.ts` queries positions (+ employees + departments) for the requested scope (company-wide, one department, one branch/focus).
2. The result is converted into a graph: nodes = positions (with computed `organizationalLevel`, department, employee/vacant state), edges = `reportsToPositionId` relationships.
3. ELK.js's layered layout algorithm computes node coordinates from the graph — departments influence horizontal grouping via a custom ELK layout option/grouping strategy; `organizationalLevel` drives vertical layering directly (it _is_ the layer index).
4. React Flow renders the ELK-computed layout: custom `OrgNode` components for cards, built-in controls for zoom/pan/fit-to-screen, a wrapped full-screen toggle, and a minimap.
5. Expand/collapse is a client-side graph-visibility toggle (which nodes/edges are currently rendered), re-triggering ELK layout for the visible subgraph — it never mutates the underlying hierarchy data.

This keeps "generate the chart" and "change the org structure" strictly separate: layout is a pure function of position/reporting data, never the other way around (business rule: HR never manually positions nodes).

## 10. Import/Export Architecture

**Import** (two-phase, per [ADR-0007](adr/0007-import-strategy.md)):

1. **Parse & validate** — `import.service.ts` parses the uploaded CSV, validates every row against the same Zod rules used for manual entry plus cross-row rules (duplicate codes within the file, unresolved Reports-To codes, cycle detection across the proposed batch), and returns a preview: valid rows, invalid rows with reasons, and a summary.
2. **Commit** — only on explicit user confirmation, the service applies the accepted rows inside a single database transaction; any failure during commit rolls back the entire batch (or the explicitly-scoped sub-batch if the user chose to exclude invalid rows before committing).

**Export**:

- `export.service.ts` prepares the data payload (respecting current filters/scope and the caller's role-based field visibility).
- PDF/PNG generation happens client-side from the rendered organogram (canvas/SVG export), per assumption A4 — no server-side headless rendering service in MVP.
- Print-friendly view is a dedicated print CSS stylesheet applied to the same organogram view (assumption A5).

## 11. Audit Architecture

- `audit.service.ts` exposes a single `record(entry, tx)` function that every mutating service call is required to invoke, passing the same transaction client used for the mutation itself ([ADR-0008](adr/0008-audit-strategy.md)).
- This guarantees an audit row and its corresponding mutation commit or roll back together — there is no scenario where a structural change persists without a matching audit entry, or vice versa.
- `AuditLog` rows are never updated or deleted through the application; if retention policy requires purging old entries, that's an explicit deferred/administrative decision, not a code path.

## 12. Error-Handling Strategy

- Domain errors are typed (`ValidationError`, `ConflictError` — e.g. duplicate code, `CycleError`, `ForbiddenError`, `NotFoundError`) thrown by the service layer.
- Server actions/route handlers catch typed domain errors and map them to a consistent client-facing error shape (`{ code, message, fieldErrors? }`); unexpected/unknown errors are logged with full detail server-side and returned to the client as a generic message — no stack traces or internal details leak to the browser.
- The UI surfaces field-level errors next to the relevant form field (from Zod/service `fieldErrors`) and top-level errors as a toast/banner for everything else.

## 13. Logging Strategy

- Structured server-side logging (JSON) for: authentication events, authorization denials, all mutating service calls (success and failure), import commit results, and unhandled exceptions.
- No PII/confidential field values in logs beyond what's necessary for the message (prefer entity IDs over raw field values).
- No secrets, tokens, or password data ever logged (`CLAUDE.md` §1.11).

## 14. Testing Architecture

Full detail in `docs/TEST_STRATEGY.md`. Summary of where each layer's tests live:

- Domain/service logic (hierarchy invariants, validation, RBAC policies): Vitest unit tests colocated with `server/services` and `server/policies`.
- Repository/DB behavior (constraints, transactions, rollback): Vitest integration tests against a real Postgres test database.
- Components (forms, organogram nodes, filters): Vitest + React Testing Library.
- End-to-end user journeys (§9 in `docs/PROJECT_SPEC.md`): Playwright against a seeded test environment.

## 15. Deployment Considerations

- Standard containerized Node.js deployment (Next.js production build) with a managed PostgreSQL instance (assumption A7 — no specific cloud provider named yet).
- Environment configuration via `.env` (never committed — `.env.example` documents required variables) for DB connection string, Auth.js secret, and any provider credentials.
- Prisma migrations run as an explicit deploy step (`prisma migrate deploy`), never `db push` in production.
- Deployment runbook and environment-variable reference are a deliverable of Phase 14 (`docs/IMPLEMENTATION_PLAN.md`).

---

## Data-Flow Narratives

### Creating a Position

UI form (`features/positions`) → client Zod validation → server action → session/role check (`HR_ADMIN`+) → `position.service.create()` re-validates with the server-side schema → checks department exists/active, code uniqueness, Reports-To exists/active and doesn't create a cycle (delegates cycle/level logic to `hierarchy.service`) → `prisma.$transaction`: insert Position row with computed `organizationalLevel` (parent's level + 1), write `AuditLog` entry → commit → server action returns the created position → UI updates the relevant list/organogram query.

### Moving a Hierarchy Branch

UI selects a position and a new Reports-To → server action → role check → `hierarchy.service.movePosition(positionId, newParentId)`: loads the position and the full descendant subtree, validates the new parent isn't the position itself or one of its own descendants (no-move-beneath-descendant rule), validates no cycle results → `prisma.$transaction`: update the position's `reportsToPositionId` and `organizationalLevel`, recompute and update `organizationalLevel` for every descendant in the subtree, write one `AuditLog` entry summarizing the move → commit; any failure at any step rolls back all of it, leaving levels untouched → organogram view re-fetches and re-lays-out the affected branch.

### Assigning an Employee

UI selects an employee (existing or new) and a target position → server action → role check → `employee.service.assign(employeeId, positionId)`: validates the position isn't `INACTIVE`, validates the employee has no other active assignment (pending P2 default), validates the target employee's `employmentStatus = ACTIVE` → `prisma.$transaction`: set `Employee.positionId`, flip `Position.status` to `FILLED` (if it was `VACANT`), write `AuditLog` entry → commit → organogram card for that position updates to show the employee instead of "Vacant."

### Importing CSV Data

Upload → `import.service.parse()` streams/parses the CSV → per-row Zod validation plus cross-row checks (duplicate codes in-file/against DB, resolvable Reports-To codes, cycle detection across the proposed final graph) → returns a preview payload (valid rows, invalid rows + reasons) — **nothing is written yet**. User reviews, optionally excludes invalid rows, confirms → `import.service.commit()` runs the accepted rows through the same `position.service`/`employee.service`/`department.service` create/update logic inside a single transaction, writes one or more `AuditLog` entries (batched or per-row, decided in Phase 10) → commit or full rollback.

### Generating the Organogram

Client requests a scope (company / department / branch / focus) → `organogram.service.getGraph(scope, requestingUser)` queries positions+employees+departments for that scope, shapes the response per the requesting role's field visibility → converts to graph nodes/edges → ELK.js computes layout (server- or client-side depending on Phase 8 implementation choice) → React Flow renders nodes/edges at the computed coordinates with department coloring and expand/collapse state.

### Exporting the Organogram

User applies filters/scope in the Full Organogram or Focus View → clicks Export → client captures the currently-rendered canvas (SVG/canvas snapshot) respecting current filters and the user's field visibility → converts to PDF (via a client-side PDF library) or PNG (canvas export) → browser download. Print view uses the same filtered/scoped data rendered through a dedicated print stylesheet instead of an export library.
