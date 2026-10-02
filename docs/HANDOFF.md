# Handoff — where the work stands (2026-10-02)

Read this first when picking the project up from another account or machine.
Project rules live in `CLAUDE.md`. Every product decision is in
`docs/DECISIONS.md`; the latest are D45–D47.

## Environments

- **Staging:** https://dotzero-organogram.vercel.app (Vercel + Supabase).
  Vercel deploys `main` automatically but **never runs migrations**; see
  "Staging migrations" below.
- **Local:** Postgres in Docker (`docker compose up -d`, container
  `organogram_postgres_dev`, port 5433), then `npm run dev` on
  http://localhost:3000. Tests use the separate `organogram_test` database
  (`.env.test`).
- **Env files are not in git.** Recreate `.env` / `.env.local` / `.env.test`
  from `.env.example`. Never commit any `.env*` file.

## Pull requests

None open. The latest work, D45–D47 (export spacing, deleting empty departments, compact content-sized cards), merged to `main` in #50 on 2026-10-02. The handoff notes merged in #51. GitHub has only `main` and the paused `health-log-db-error-code` branch.

## Still to do

1. ~~**Delivery Org / Administration on staging.**~~ **Done 2026-10-02.**
   - Created: the COO (under the CEO), sub-divisions Admin and IT with their 7-role chains, and seats for Hammad Hussain, Junaid Hassan, Rana Faraz and Faraz Khurram. Levels are not set yet; set them on the Positions page.
   - The script is kept for reference.
   - **Lesson for any script run against staging from a laptop:** a round trip to the Sydney database takes about 3 seconds. Give the script its own `PrismaClient` with `transactionOptions: { timeout: 120_000 }` and pass it to the services, as this script does. Prisma's default 5-second transaction timeout otherwise rolls every write back.
   - Supabase's connection string contains a literal `[YOUR-PASSWORD]`. Fill in the real password, URL-encoded.

1a. **Engineering on staging: done 2026-10-02** (`scripts/add-engineering-org.ts`). - **Structure:** CEO → CTO → VP → Director → Asst. Director → five Associate Directors over QA / QAA, UI/UX, DevOps, Backend + DE, and Mobile. Each sub-division has an IC line and a manager line that meet (two heads) at its first "Sr. … Engineer" role. - **Size:** 93 positions, 11 people seated. Engineering was reactivated. - **Still to do in the app:** - set levels; - fill the shared Backend boxes (Principal Software Engineer II: M. Fawad, Irfan Mumtaz; Principal Software Engineer: Ghulam Nabi, Waqas Ansari, Zeeshan Rasheed, Owais Hassan Zaidi, Haris Ali; Tech Lead: Maha Dev, Affan Younus). Add one position per extra person if each needs a seat.

2. **Now possible (#50 is live):** delete the old separate **IT** department (the
   sub-division replaces it).
3. ~~Engineering is inactive~~ — reactivated with the Engineering branch (1a).
4. **Security housekeeping:**
   - rotate the Supabase database password and update it in Vercel;
   - delete the old local `.env.staging` (it holds a Vercel token).
5. **Paused work:** branch `health-log-db-error-code` adds the database
   driver's error code to the readiness-check log. It has a test. It is based
   on an old `main`, so rebase it before opening a PR.
6. **Optional:** run `scripts/copy-staging-to-local.ts` to refresh local data
   from staging (read-only on staging).

## How work is done here

- Run the tests and update the specs/docs with every change. Add each
  decision to `docs/DECISIONS.md`.
- Work on a branch, open a PR, and let CI pass. Only the owner merges; never
  enable auto-merge.
- **Checks:** `npm run typecheck`, `npm run lint`, `npm test`,
  `npm run test:integration`, `npm run test:e2e`.
  - Stop any `npm run dev` first: Next.js allows one dev server per folder.
  - Visual snapshots: `npm run test:e2e -- e2e/organogram-visual.spec.ts --update-snapshots=all`.
    Review the PNGs before committing.
- **New migration:** add its folder name to `EXPECTED_MIGRATIONS` in
  `lib/db/expected-migrations.ts`. Add new tables to the schema test's
  expected-table list too.
- **CI:** jobs run `prisma generate` before the typecheck. The schema is at
  the repo root (`--schema ../prisma/schema.prisma` when run from a subfolder).
- **Never automate drags in Arrange mode** against real data: a drag saves
  card positions for everyone.

## Staging migrations

1. Create `.env.staging.local` with `DIRECT_DATABASE_URL` (port 5432) and
   `DATABASE_URL` (port 6543, `pgbouncer=true`).
2. Run:

   ```bash
   npx dotenv -e .env.staging.local -- npx prisma migrate deploy
   ```

3. Check https://dotzero-organogram.vercel.app/api/health/ready. It flags
   pending migrations only.
4. Delete the env file.

There are 14 migrations as of this handoff, and staging has all of them.
