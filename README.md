# Dynamic Organogram Manager

Internal web application that lets HR independently manage departments, positions, employees, vacancies, and primary reporting relationships — and automatically generates the company organogram from that data. HR never manually places chart nodes.

Full product and technical context: [docs/PROJECT_SPEC.md](docs/PROJECT_SPEC.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DECISIONS.md](docs/DECISIONS.md), [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

## Current Implementation Status

**Phase 12 of 14 (Audit Log, User Administration, and Settings).** See [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) for the full phase list, and the phase reports under [docs/phase-reports/](docs/phase-reports/) for verification evidence — most recently [PHASE_12_AUDIT_ADMIN_AND_SETTINGS.md](docs/phase-reports/PHASE_12_AUDIT_ADMIN_AND_SETTINGS.md).

**What's implemented so far:** the application shell (Phase 1); the full PostgreSQL/Prisma schema and domain layer (Phase 2, see [docs/DOMAIN_MODEL.md](docs/DOMAIN_MODEL.md)/[docs/DATA_DICTIONARY.md](docs/DATA_DICTIONARY.md)); provider-neutral Company SSO via Auth.js and deny-by-default RBAC (ADMIN/HR_EDITOR/VIEWER — see [docs/AUTHORIZATION_MATRIX.md](docs/AUTHORIZATION_MATRIX.md)), server-side permission enforcement on every route (Phase 3); full Department management — list/create/edit/archive/reactivate (Phase 4); full Position and reporting-hierarchy management — list/create/edit, a dedicated "Change Reports-To" flow with descendant-level recalculation, archive/reactivate (Phase 5); full Employee management — list/create/edit, assign/transfer/end-assignment, a guided "Terminate Employee" workflow, and assignment history, all with department/manager/organizational-level fields derived (never stored) from the active position assignment (Phase 6); a read-only Company Overview dashboard — live summary cards, organizational-depth breakdown, a department-by-department table, a documented vacancy-rate calculation, and permission-gated data-quality warnings, all server-calculated on every load with no caching (Phase 7, see [docs/DASHBOARD_METRICS.md](docs/DASHBOARD_METRICS.md)); an interactive, automatically-generated organogram — a React Flow + ELK.js canvas (root at top, levels expanding downward, siblings arranged horizontally), expand/collapse with a safe default depth, Fit to View/Reset View, a read-only Details Panel, department-colored nodes with vacant/planned/inactive visibility, and a mandatory accessible Outline View reading the identical server data (Phase 8, see [docs/ORGANOGRAM_RENDERING.md](docs/ORGANOGRAM_RENDERING.md) for the full data contract and rendering rules); on top of that same organogram, ranked search, department/level/job-grade/occupancy/status filters, Full Company/Position/Department Focus views, and shareable, privacy-reviewed deep links — a filtered or focused view never fabricates a reporting relationship that doesn't exist, preserving every real intermediary as visible "context" (Phase 9, see [docs/ORGANOGRAM_SEARCH_AND_FOCUS.md](docs/ORGANOGRAM_SEARCH_AND_FOCUS.md)); a bulk CSV import/update pipeline for Departments, Positions, Employees, and Position Assignments — upload, validate (writes nothing), preview every proposed create/update with field-level diffs, confirm, and execute, entirely transactionally and re-validated fresh against the database at execute time so nothing is ever partially applied (Phase 10, see [docs/CSV_IMPORT_GUIDE.md](docs/CSV_IMPORT_GUIDE.md)); server-side PDF/PNG organogram export — Full Company, Current View, Position Focus, and Department Focus scopes, all rendered from the exact same hierarchy/layout the interactive chart uses (never a viewport screenshot, never an independently recalculated layout), with private storage and a server-checked download on every request (Phase 11, see [docs/ORGANOGRAM_EXPORT_GUIDE.md](docs/ORGANOGRAM_EXPORT_GUIDE.md)); and an append-only audit trail, in-app user administration, and company settings (Phase 12, see [docs/AUDIT_AND_ADMIN_GUIDE.md](docs/AUDIT_AND_ADMIN_GUIDE.md)) — every Department/Position/Employee/Assignment/Import/Export mutation now writes a redacted, database-trigger-enforced-immutable audit event in the same transaction as the change it documents; an ADMIN-only `/users` screen provisions Company SSO users, changes roles, and disables/reactivates accounts with transactional last-admin protection (alongside the unchanged Phase 3 CLI); and `/settings` covers company profile plus organogram/export defaults, with the SSO client secret and all provider tokens never readable through the UI. Every mutation — manual or imported — is re-validated and re-authorized server-side regardless of what the client sent, and import always writes through the exact same domain services manual entry uses, never a parallel path; the organogram itself still has no mutation path at all — hierarchy editing on the canvas is explicitly out of scope.

**What is NOT implemented yet:** image/PDF export, drag-and-drop hierarchy editing, dotted-line/secondary reporting, historical/future org-chart snapshots, audit logging, and an in-app user-management UI. Those routes/features remain honest, permission-gated placeholders (or are simply absent from the organogram's UI) — see the "Planned for Phase N" notice on each placeholder route.

## Technology Stack

Next.js (App Router) · TypeScript (strict mode) · Tailwind CSS v4 · Radix UI primitives (shadcn/ui-style components) · Zod (environment/input validation) · **PostgreSQL + Prisma ORM** · **Auth.js (provider-neutral OIDC / Company SSO)** · Vitest + React Testing Library (unit/component tests) · Playwright (E2E) · ESLint + Prettier

Exact pinned dependency versions and why: [docs/phase-reports/PHASE_01_FOUNDATION.md](docs/phase-reports/PHASE_01_FOUNDATION.md) and [docs/phase-reports/PHASE_02_DATABASE_AND_DOMAIN.md](docs/phase-reports/PHASE_02_DATABASE_AND_DOMAIN.md) — several of the newest available majors (ESLint 10, Vite 8, jsdom 30, TypeScript 7, Prisma 8-rc) were skipped in favor of the newest version that's genuinely compatible with the rest of the toolchain and with common Node LTS versions.

## Prerequisites

- Node.js `>=20.9.0` (LTS recommended; CI runs on Node 20)
- npm (bundled with Node — this project does not use pnpm or yarn; see [docs/DECISIONS.md](docs/DECISIONS.md) A8)
- **Docker** (for local PostgreSQL — see Database Setup below). Any PostgreSQL 16+ instance works if you'd rather not use Docker; Docker Compose is just the documented, reproducible path.

## Installation

```bash
npm install
```

## Environment Setup

1. Copy the example file:

   ```bash
   cp .env.example .env
   ```

   Prisma's CLI reads `.env` (not `.env.local`) by default — `.env` is the right place for `DATABASE_URL` so both Prisma and Next.js pick it up consistently. Use `.env.local` only for browser-safe (`NEXT_PUBLIC_*`) values if you want them layered separately.

2. Set `NEXT_PUBLIC_APP_NAME` (required — the app will not start without it; see [lib/env.ts](lib/env.ts)). The example value in `.env.example` works as-is.
3. Set `DATABASE_URL` — **required as of Phase 2**. If you're using the Docker Compose setup below, the value in `.env.example` already matches it exactly.
4. Set the `AUTH_*` variables — **required as of Phase 3**. See "Company SSO Setup" below for what each one means and how to point them at a real identity provider.
5. Never commit `.env`, `.env.local`, or `.env.test` — all three are git-ignored. Never put a secret behind a `NEXT_PUBLIC_` variable; anything with that prefix ships to every visitor's browser.

## Company SSO Setup

This application authenticates exclusively via **Company SSO** — there is no username/password login, no self-registration, and no password stored anywhere. The specific identity provider your organization uses has not been confirmed yet (see [docs/DECISIONS.md](docs/DECISIONS.md) P8), so the integration is a **provider-neutral OIDC** client (Auth.js): it works against any standards-compliant OIDC provider — Microsoft Entra ID, Google Workspace, Okta, or another — purely through environment configuration, with zero provider-specific code anywhere in this repository. See [docs/adr/0010-authjs-provider-neutral-oidc.md](docs/adr/0010-authjs-provider-neutral-oidc.md) for the full rationale.

### Configuring a real provider

Register this application with your identity provider (an "app registration" in Entra ID, an "OAuth client" in Google Workspace/Okta) as an OpenID Connect confidential client, with a redirect/callback URL of:

```
<your-app-origin>/api/auth/callback/company-sso
```

Then set these in `.env` (never commit real values — see `.env.example` for the full list with inline explanations):

| Variable                      | Meaning                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_SECRET`                 | Random 32+ character secret used to sign session cookies. Generate with `openssl rand -base64 32`. Never reuse across environments.                           |
| `AUTH_OIDC_ISSUER`            | Your provider's OIDC issuer URL — endpoints are auto-discovered from `<issuer>/.well-known/openid-configuration`.                                             |
| `AUTH_OIDC_CLIENT_ID`         | The client ID from your provider's app registration.                                                                                                          |
| `AUTH_OIDC_CLIENT_SECRET`     | The client secret from your provider's app registration. Treat as a real secret — never commit it.                                                            |
| `AUTH_ALLOWED_EMAIL_DOMAINS`  | **Required.** Comma-separated list of company email domains allowed to sign in. There is no wildcard/empty default.                                           |
| `AUTH_ALLOWED_TENANT_ID`      | Optional — restrict sign-in to a specific tenant/directory (e.g. an Entra ID tenant ID). Leave unset to rely on the domain check alone.                       |
| `AUTH_OIDC_TENANT_CLAIM`      | Which profile claim carries the tenant identifier when `AUTH_ALLOWED_TENANT_ID` is set (default `"tid"`, Entra ID's convention).                              |
| `AUTH_PROVIDER_NAME`          | Display label only, shown on the sign-in button (e.g. `"Acme Account"`). Never a hard-coded vendor name in source.                                            |
| `AUTH_AUTO_PROVISION_VIEWERS` | `"false"` by default (deny-by-default). Set `"true"` only if any domain-allowed SSO user should automatically get read-only `VIEWER` access on first sign-in. |
| `AUTH_TRUST_HOST`             | Set `"true"` only if deploying behind a reverse proxy or a non-standard host, per Auth.js's own trust-host documentation.                                     |

### Roles and provisioning

Three roles — `ADMIN`, `HR_EDITOR`, `VIEWER` — see [docs/AUTHORIZATION_MATRIX.md](docs/AUTHORIZATION_MATRIX.md) for the full permission breakdown. There is **no self-service path to `ADMIN` or `HR_EDITOR`** — those can only be granted via the CLI:

```bash
# First admin, for a company that already exists in the database (see db:seed)
npm run auth:provision -- create-admin --email "jane@your-company.example" --company YOUR-COMPANY-CODE

# Any role
npm run auth:provision -- add --email "sam@your-company.example" --role HR_EDITOR --company YOUR-COMPANY-CODE

# Change a role, disable/re-enable a user, or list everyone
npm run auth:provision -- set-role --email "sam@your-company.example" --role ADMIN
npm run auth:provision -- disable --email "sam@your-company.example"
npm run auth:provision -- enable --email "sam@your-company.example"
npm run auth:provision -- list
```

If `AUTH_AUTO_PROVISION_VIEWERS="true"`, any first-time SSO sign-in from an allowed domain automatically gets read-only `VIEWER` access — and only `VIEWER`, never a higher role, and only when the database has exactly one `Company` row (an ambiguous multi-company database refuses to guess and denies sign-in instead — see [docs/adr/0011-rbac-and-provisioning.md](docs/adr/0011-rbac-and-provisioning.md)).

Every mutating `auth:provision` command refuses to run under `NODE_ENV=production` unless you pass `--yes-i-am-sure-this-is-production` explicitly.

A disabled user (`status: DISABLED`) is blocked on their very next request, regardless of role — sessions are database-backed, not JWT, specifically so a disable/role-change takes effect immediately rather than waiting for a token to expire (see [docs/adr/0012-session-and-route-protection.md](docs/adr/0012-session-and-route-protection.md)).

**Since Phase 12, an ADMIN can also provision users, change roles, disable/reactivate, and link an Employee entirely in-app** at `/users` — no CLI/deploy access required for day-to-day administration. The CLI above remains the only way to bootstrap the very first ADMIN for a brand-new company, and is unaffected by the web UI's existence. See [docs/AUDIT_AND_ADMIN_GUIDE.md](docs/AUDIT_AND_ADMIN_GUIDE.md) and [docs/adr/0014-web-based-user-administration.md](docs/adr/0014-web-based-user-administration.md).

### Local development and testing without a real provider

Nothing in this repository ever needs to contact a real identity provider to run or test locally:

- `.env.test` uses obviously-fake `AUTH_OIDC_*` placeholder values — unit and integration tests never make a network call to any IdP.
- `npm run test:e2e` uses a **mocked-auth strategy** (`e2e/support/seed-session.ts`): it writes a real session row directly into the test database (bypassing the OIDC flow entirely, since no provider is confirmed yet) so Playwright can drive the app as a signed-in `ADMIN`. See `e2e/auth.spec.ts` for the complementary genuinely-unauthenticated-access tests.
- To try the app locally against real data without a live IdP, use `npm run auth:provision -- create-admin ...` to provision yourself, then use your browser's dev tools to set an `authjs.session-token` cookie against a session row you create the same way `seed-session.ts` does — or wait until a real provider is configured, at which point normal sign-in works as-is.

## Database Setup (local development)

This project uses **PostgreSQL** — never SQLite or another engine as a substitute, even locally, so behavior matches production (`CLAUDE.md`).

1. Start local PostgreSQL via Docker Compose (runs on host port **5433**, deliberately non-default, so it won't collide with any other Postgres instance already on your machine):

   ```bash
   docker compose up -d
   ```

   This creates two databases inside the same container: `organogram_dev` (for `npm run dev`/manual poking via Prisma Studio) and `organogram_test` (for automated integration tests) — kept separate so a test run never touches data you're looking at manually.

2. Apply migrations to the dev database:

   ```bash
   npm run db:migrate:dev
   ```

3. Seed it with a small, fully fictional example org (idempotent — safe to run repeatedly, and refuses to run unless `NODE_ENV` is `development` or `test`):

   ```bash
   NODE_ENV=development npm run db:seed
   ```

4. Apply migrations to the **separate** test database (only needed once, or after adding a new migration):

   ```bash
   npm run db:migrate:test
   ```

5. Inspect the schema visually (optional):

   ```bash
   npm run db:studio
   ```

**⚠️ Destructive commands — read before running:** `prisma migrate reset` drops and recreates the target database. This project deliberately does **not** wrap it in an npm script, and Prisma's own CLI will refuse to run it from an AI agent without your explicit, freshly-given consent even if asked to. If you need to reset your local dev database by hand, run `npx prisma migrate reset` yourself and confirm the prompt — never point it at anything other than your own local `organogram_dev`/`organogram_test`.

## Local Development

```bash
npm run dev
```

Opens at `http://localhost:3000` and redirects to `/dashboard` — the real, live Company Overview (Phase 7). Sign in, then visit `/organogram` for the real, interactive chart with search/filters/focus, shareable deep links, and PDF/PNG export (Phases 8–9, 11), `/imports` for bulk CSV import (Phase 10), `/departments`, `/positions`, `/employees` for the database-backed CRUD screens, or (ADMIN/HR_EDITOR) `/audit-log`, `/users`, `/settings` for the audit trail, user administration, and company settings (Phase 12).

## Commands

| Command                     | Purpose                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `npm run dev`               | Start the local dev server                                                                 |
| `npm run build`             | Production build                                                                           |
| `npm run start`             | Run the production build locally                                                           |
| `npm run lint`              | ESLint                                                                                     |
| `npm run lint:fix`          | ESLint with auto-fix                                                                       |
| `npm run format`            | Prettier — write                                                                           |
| `npm run format:check`      | Prettier — check only (used in CI)                                                         |
| `npm run typecheck`         | `tsc --noEmit`, strict mode                                                                |
| `npm run test`              | Vitest — unit + component tests, single run                                                |
| `npm run test:watch`        | Vitest — watch mode                                                                        |
| `npm run test:coverage`     | Vitest with coverage report (`coverage/`)                                                  |
| `npm run test:e2e`          | Playwright E2E/smoke tests (auto-starts a dev server)                                      |
| `npm run quality`           | The full local quality gate: format check → lint → typecheck → tests with coverage → build |
| `npm run db:migrate:dev`    | Apply/create migrations against the dev database (`organogram_dev`)                        |
| `npm run db:migrate:deploy` | Apply existing migrations without prompting (CI/production-style)                          |
| `npm run db:migrate:test`   | Apply existing migrations against the test database (`organogram_test`)                    |
| `npm run db:seed`           | Run the idempotent, fictional-data seed script (blocked outside dev/test `NODE_ENV`)       |
| `npm run db:studio`         | Open Prisma Studio (visual schema/data browser) against the dev database                   |
| `npm run db:generate`       | Regenerate the Prisma Client after a schema change                                         |
| `npm run test:integration`  | Database integration tests against a real PostgreSQL test database                         |

## Project Structure

```
app/                    Next.js App Router routes
  (app)/                Route group sharing the AppShell layout — all 8 permission-gated placeholder modules live here
  (auth)/               Sign-in and access-denied pages
  api/auth/[...nextauth] Auth.js route handler
  api/health/           Health-check endpoint
  layout.tsx, page.tsx, not-found.tsx, error.tsx   Root-level layout/redirect/error handling
components/
  ui/                   Small shadcn/ui-style primitives (Button, Badge, Separator, Sheet)
  layout/               Shell composition — header, desktop/mobile nav, environment badge, account-area
  patterns/             Reusable page patterns — PageHeader, EmptyState, LoadingState, ErrorState, PlaceholderModule
lib/
  env*.ts, logger.ts, errors.ts   Foundation utilities (Phase 1)
  db/                   Prisma client singleton (server-only) and the test-database safety guard
  domain/               Pure, framework-independent business rules — cycle detection, level calculation, vacancy/overlap logic, normalization (no Prisma imports; unit-testable in isolation)
  services/             Prisma-aware orchestration — transactions, company-scoped validation, sign-in resolution
  repositories/         Minimal, typed data-access functions (no public CRUD API yet — CLAUDE.md §1.9)
  auth/                 Auth.js config, permissions, identity validation, session/route-protection helpers (see docs/AUTHORIZATION_MATRIX.md)
config/                 Single-source-of-truth navigation config (with per-item permission), site metadata
prisma/
  schema.prisma         Full domain + auth schema (Company, Department, JobGrade, Position, Employee, PositionAssignment, User, Account, Session, VerificationToken)
  migrations/           SQL migrations, including hand-authored CHECK constraints and partial unique indexes Prisma's schema DSL can't express
  seed.ts               Idempotent, fictional-data seed (see Database Setup above)
scripts/
  provision-user.ts     CLI-only user/role provisioning (see Company SSO Setup above)
e2e/                    Playwright specs, plus support/seed-session.ts (mocked-auth strategy) and auth.setup.ts
tests/integration/      Database integration tests (real PostgreSQL, separate Vitest config)
docs/                   Product spec, architecture, decisions, data dictionary, domain model, authorization matrix, implementation plan, ADRs, phase reports
.claude/skills/         Project-local Claude Code skills used across phases
docker-compose.yml      Local PostgreSQL (dev + test databases), port 5433
```

Full rationale for this structure: [docs/ARCHITECTURE.md §3](docs/ARCHITECTURE.md).

## Testing

- `npm run test` — unit + component tests (Vitest, jsdom). No database required; injects a safe `NEXT_PUBLIC_APP_NAME` directly (`vitest.config.mts`).
- `npm run test:integration` — database integration tests against the **real, separate** `organogram_test` database (`vitest.integration.config.mts`). Requires `docker compose up -d` to be running and `npm run db:migrate:test` to have been applied at least once.
- Integration tests **truncate all domain tables before every test** (`tests/integration/setup.ts`) for isolation. Before doing so, they call `assertSafeTestDatabaseUrl()` (`lib/db/test-guard.ts`), which refuses to run unless the target database's name contains `test` and doesn't look production-related — this is the guard standing between the test suite and ever truncating a real database.
- `npm run test:e2e` — Playwright smoke tests (`vitest.config.mts`'s sibling, `playwright.config.ts`). **Requires a running database** as of Phase 3 — the mocked-auth `setup` project (`e2e/auth.setup.ts`) writes a real session row before the rest of the suite runs (see "Company SSO Setup" above). Loads `.env.test` automatically via `dotenv-cli`.

## Troubleshooting

- **"Invalid public environment configuration" / "Invalid server environment configuration" at startup** — you haven't set `NEXT_PUBLIC_APP_NAME` or `DATABASE_URL`. Copy `.env.example` to `.env` (see Environment Setup above).
- **`Can't reach database server` / Prisma connection errors** — confirm `docker compose ps` shows `organogram_postgres_dev` as healthy; run `docker compose up -d` if not. Confirm your `DATABASE_URL` port matches (`5433`, not the Postgres-default `5432` — deliberately non-default to avoid colliding with another local Postgres instance).
- **Migration fails with "relation already exists" or similar** — your local dev database has drifted from the migration history (e.g. from manual `psql` edits). For a _local, disposable_ dev database, `npx prisma migrate reset` will recreate it from migrations — Prisma's CLI will prompt you to confirm before doing anything (see the destructive-commands warning under Database Setup). Never run this against anything you don't own outright.
- **Integration tests fail with "Refusing a destructive test-database operation"** — your `DATABASE_URL` doesn't point at something with "test" in the database name, or it looks production-related. This is `lib/db/test-guard.ts` working as intended — fix your `.env.test`/environment, don't bypass the guard.
- **Playwright can't find a browser** — run `npx playwright install chromium` once locally (CI does this automatically).
- **"Invalid server environment configuration" mentioning `AUTH_*`** — copy the `AUTH_*` block from `.env.example` into your `.env` and fill in real (or, for local exploration, placeholder) values — see "Company SSO Setup" above.
- **`UntrustedHost` error from Auth.js** — you're running the dev server against a non-`localhost` host/port (e.g. `127.0.0.1`) under a non-`"development"` `NODE_ENV`. Set `AUTH_TRUST_HOST="true"` for that run (already set in `.env.test`).
- **Buttons/menus don't respond to clicks in dev mode, with no console error** — check that the origin you're loading the app from is listed in `next.config.ts`'s `allowedDevOrigins` (currently `127.0.0.1` and `localhost`). Next's dev-mode cross-origin protection silently blocks the client JS bundle for any other origin — the page renders but never hydrates. Discovered and fixed in Phase 3; see that phase's report for the full diagnosis.
- **E2E tests fail with a database-connection error** — `npm run test:e2e` needs `docker compose up -d` running and `npm run db:migrate:test` applied, same as `npm run test:integration` (the mocked-auth setup project writes a real session row before the rest of the suite runs).
- **Port 3000 already in use** — another process is using it; stop it, or run `npm run dev -- -p 3001`.
- **`npm install` warns about an unsupported engine** — this repo pins several dev-tool versions specifically for broad Node-version compatibility (see [docs/phase-reports/PHASE_01_FOUNDATION.md](docs/phase-reports/PHASE_01_FOUNDATION.md)); a warning from a transitive dependency you haven't touched is usually safe to ignore, but if a command actually fails, check your Node version first (`node -v`, need `>=20.9.0`).

## Security Note

No real secrets exist in this repository. `.env.example` contains placeholder values only. Server-only configuration (`DATABASE_URL`, the Prisma client itself) is enforced at the module level via the `server-only` package — importing `lib/env.server.ts` or `lib/db/prisma.ts` from client-side code fails the build rather than silently bundling a secret into the browser (verified by `lib/env.server-boundary.test.ts` and `lib/db/prisma.server-boundary.test.ts`). Seed data (`prisma/seed.ts`) is entirely fictional — no real employee data ever appears in this repository. See `CLAUDE.md` §1.11 and §2, and `docs/PROJECT_SPEC.md` §13.
