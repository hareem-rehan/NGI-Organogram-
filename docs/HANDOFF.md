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

## Open pull requests (merge in this order)

| PR  | What                                             | Notes                        |
| --- | ------------------------------------------------ | ---------------------------- |
| #48 | Export: proper spacing for large card text (D45) | CI green                     |
| #49 | Empty department can be deleted (D46)            | CI green                     |
| #50 | Compact, content-sized cards (D47)               | Contains #48 and #49 already |

No migrations in any of them. After merging, delete the three branches.

## Still to do

1. **Delivery Org / Administration on staging.** Done locally only. Run
   `scripts/add-delivery-org-subdivisions.ts` against staging. It is dry-run by
   default and safe to re-run (nothing is duplicated). It creates the COO
   (under the CEO), the sub-divisions Admin and IT with their 7-role chains, and
   seats Hammad Hussain, Junaid Hassan, Rana Faraz and Faraz Khurram:

   ```bash
   npx dotenv -e .env.staging.local -- npx tsx --conditions=react-server scripts/add-delivery-org-subdivisions.ts
   APPLY=1 npx dotenv -e .env.staging.local -- npx tsx --conditions=react-server scripts/add-delivery-org-subdivisions.ts
   ```

   `.env.staging.local` holds the staging `DATABASE_URL`. The person who owns
   the password enters it themselves, never in chat. Delete the file afterwards.

2. **After #49 is live:** delete the old separate **IT** department (the
   sub-division replaces it).
3. **Engineering** is hidden because it is marked Inactive. Reactivate it on
   the Departments page if it should show.
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
