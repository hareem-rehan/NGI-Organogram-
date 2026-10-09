# Handoff — where the work stands (2026-10-10)

Read this first when picking the project up from another account or machine.
Project rules live in `CLAUDE.md`. Every product decision is in
`docs/DECISIONS.md`; the latest are D48–D54 (summarised below).

## Environments

- **Staging:** https://dotzero-organogram.vercel.app (Vercel + Supabase).
  Vercel deploys `main` automatically but **never runs migrations**; see
  "Staging migrations" below.
- **Local:** Postgres in Docker (`docker compose up -d`, container
  `organogram_postgres_dev`, port 5433), then `npm run dev` on
  http://localhost:3000. Tests use the separate `organogram_test` database
  (`.env.test`).
  - Docker Desktop tends to pause itself when idle. If sign-in fails with
    Prisma `P1001` ("can't reach database server"), restart Docker and run
    `docker compose up -d`.
  - Local sign-in: http://localhost:3000/dev-sign-in (local development only).
- **Env files are not in git.** Recreate `.env` / `.env.local` / `.env.test`
  from `.env.example`. Never commit any `.env*` file.

## Pull requests and branches

None open. GitHub has only `main`. The last change merged was #62 on
2026-10-09.

## What changed since the last handoff (2026-10-02 → 2026-10-09)

| PR  | Decision | What users see                                                                                                                                                                                                                |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #56 | D48, D49 | Straight, centred connectors; one set of rows across departments; two-head cards centred between both heads. **Undo** in Arrange mode (Ctrl/Cmd+Z, 20 steps). Fixed-width cards; long titles wrap onto up to three lines.     |
| #57 | D50      | The text-style panel shows the colour a card really uses, and explains when a hard-to-read colour was swapped.                                                                                                                |
| #58 | —        | The readiness health check logs the database driver's error code (e.g. `P1000`, `P1001`) when it fails, never the message.                                                                                                    |
| #59 | D51      | No Code field on the Department form; codes are generated from the name (HR, DOA, ENG…).                                                                                                                                      |
| #60 | D52      | Department codes are hidden everywhere (list, dialogs, details panel, dashboard, audit labels). CSV imports identify departments by **name**; old files with code columns still work. Department names are unique (any case). |
| #61 | D53      | More fits on screen (about 32% less area): tighter gaps, 168px cards. A mini-map (bottom right) and a **Zoom** button on department/sub-division boxes.                                                                       |
| #62 | D54      | The chart opens as a 30% overview, centred on the CEO and the department row (fitted, up to 100%, if a small chart fits).                                                                                                     |

Also done on staging (data, not code), with scripts kept in `scripts/`:

- **Delivery Org / Administration** (#53, `scripts/add-delivery-org-subdivisions.ts`): the COO under the CEO, sub-divisions Admin and IT with their 7-role chains, and four people seated.
- **Engineering** (#54, `scripts/add-engineering-org.ts`): CEO → CTO → VP → Director → Asst. Director → five Associate Directors over QA / QAA, UI/UX, DevOps, Backend + DE and Mobile. Each sub-division has an IC line and a manager line that meet (two heads) at its first "Sr. … Engineer" role. That's 93 positions with 11 people seated, and Engineering was reactivated.
- Both scripts are idempotent (re-running creates nothing) and go through the app's own services, so their changes are audit-logged.

## User manual

- **Version 1.2** (2026-10-09) covers everything above. It's a Word file kept **outside the repo**, on the original machine:
  `~/Downloads/DotZero-Organogram-User-Manual.docx`, with v1.1 and v1.0 beside it. If you need it on another machine, ask the owner for the file.
- Screenshots were made with a temporary Playwright script against the local dev server. It isn't kept in the repo. The style is a 1080×675 window at 2× scale, with red outlines and numbered red circles.
- Update the manual whenever a screen it shows changes.

## Still to do

1. **Fill in the new branches on staging (in the app):**
   - **Levels:** Delivery Org and Engineering positions have no levels set yet; set them on the Positions page.
   - **Shared Backend boxes:** these are vacant on purpose.
     - Principal Software Engineer II: M. Fawad, Irfan Mumtaz.
     - Principal Software Engineer: Ghulam Nabi, Waqas Ansari, Zeeshan Rasheed, Owais Hassan Zaidi, Haris Ali.
     - Tech Lead: Maha Dev, Affan Younus.

     Add one position per extra person if each needs their own seat.
2. **Tidy hand-placed cards on staging.** Cards dragged before D48/D49/D53 keep their old offsets, which no longer line up with the new automatic layout, so their lines bend. In Arrange mode, **Reset positions** fixes it, and **Undo** can bring them back.
3. **Check department names on staging.** Since D52 names are unique. Older data may have two departments with the same name; an import naming one of them is refused until one is renamed.
4. **Old separate IT department** (if still there): delete it. The IT sub-division under Delivery Org replaces it, and #49 made empty departments deletable.
5. **Security housekeeping:**
   - rotate the Supabase database password and update it in Vercel;
   - delete the old local `.env.staging` (it holds a Vercel token).
6. **Optional:** run `scripts/copy-staging-to-local.ts` to refresh local data from staging (read-only on staging).

## How work is done here

- Run the tests and update the specs/docs with every change. Add each
  decision to `docs/DECISIONS.md`.
- Work on a branch, open a PR, and let CI pass **before** merging. Only the
  owner merges; never enable auto-merge. A PR merged before CI finished once
  broke the Vercel deploy.
- **Checks:**
  - `npm run typecheck`, `npm run lint`, `npm test`
  - `npm run test:integration`. Run it for **any** layout or export change too: the export tile-page tests depend on chart size.
  - `npm run test:e2e`
    - Stop any `npm run dev` first: Next.js allows one dev server per folder.
    - **Known flakes:**
      - the very first setup step (`auth.setup.ts`) on a cold server;
      - a few unrelated specs when many suites run together under load.

      Rerun those specs on their own before treating a failure as real.

    - Visual snapshots: `npm run test:e2e -- e2e/organogram-visual.spec.ts --update-snapshots=all`. Review the PNGs before committing.
- **New migration:** add its folder name to `EXPECTED_MIGRATIONS` in
  `lib/db/expected-migrations.ts`. Add new tables to the schema test's
  expected-table list too.
- **CI:** jobs run `prisma generate` before the typecheck. The schema is at
  the repo root (`--schema ../prisma/schema.prisma` when run from a subfolder).
- **Never automate drags in Arrange mode** against real data: a drag saves
  card positions for everyone.
- **Local one-off scripts not in git:** `scripts/apply-visily-config-to-staging.ts`, `remodel-subdivisions-and-names.ts`, `replace-org-from-csv.ts`, `wipe-positions.ts`. They're kept out on purpose because they can delete or overwrite data. Don't commit or run them casually.

## Running a script against staging

1. The person who owns the password enters it themselves, never in chat.
   - Supabase's connection string contains a literal `[YOUR-PASSWORD]`; fill in the real password, URL-encoded.
   - Save the result to `.env.staging.local` as `DATABASE_URL`, git-ignored and readable only by the owner (`chmod 600`).
2. Always do a dry run first and get the owner's go-ahead before writing.
3. A round trip from a laptop to the Sydney database takes about 3 seconds. Give the script its own `PrismaClient` with `transactionOptions: { timeout: 120_000 }` and pass it to the services, as both data scripts do. Prisma's default 5-second transaction timeout otherwise rolls every write back.
4. A wrong password shows up as `P1001` ("can't reach database server"), not as an authentication error. Don't retry repeatedly; Supabase may block the IP.
5. Delete `.env.staging.local` when done.

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
None of the changes since 2026-10-02 added a migration.
