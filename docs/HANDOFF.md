# Handoff — where the work stands (2026-10-20)

Read this first when picking the project up from another account or machine.
Project rules live in `CLAUDE.md`. Every product decision is in
`docs/DECISIONS.md`; the latest are D55–D62 (summarised below).

## Environments

- **Staging:** https://dotzero-organogram.vercel.app (Vercel + Supabase).
  Vercel deploys `main` automatically but **never runs migrations**; see
  "Staging migrations" below.
- **Local:** Postgres in Docker (`docker compose up -d`, container
  `organogram_postgres_dev`, port 5433, database `organogram_dev`), then
  `npm run dev` on http://localhost:3000. Tests use the separate
  `organogram_test` database (`.env.test`).
  - **"Localhost not working"** almost always means Docker Desktop stopped
    (it pauses itself when idle) or the dev server isn't running. Start Docker
    Desktop, run `docker compose up -d`, then `npm run dev`. Check
    http://localhost:3000/api/health/ready: it should say `"status":"ok"` and
    `migrationsApplied` 16 of 16. Sign-in failing with Prisma `P1001` means the
    database is down.
  - Local sign-in: http://localhost:3000/dev-sign-in (ADMIN, HR_EDITOR or
    VIEWER; local development only).
- **Env files are not in git.** Recreate `.env` / `.env.local` / `.env.test`
  from `.env.example`. Never commit any `.env*` file.

## Pull requests and branches

None open apart from this handoff. GitHub has only `main`. The last feature
merged was #75 on 2026-10-20, and staging runs it.

## What changed since the last handoff (2026-10-10 → 2026-10-20)

| PR  | Decision | What users see                                                                                                                                                                                                                                                                                                         |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #64 | D55      | In Arrange mode, dragging a department or sub-department box along its row reorders it, and its branch moves with it. Old hand placements of boxes are ignored.                                                                                                                                                        |
| #65 | D55      | Sub-division (yellow) boxes are drawn in their saved order too.                                                                                                                                                                                                                                                        |
| #66 | D56      | **Several employees can hold one position.** The Position form's _Assigned employees_ field adds and removes people (one employee still holds at most one position). Migration `20261014120000_multiple_occupants_per_position`.                                                                                       |
| #67 | D57      | No Code field for sub-divisions (generated from the name). Duplicate employee code is flagged while typing. Employee table sorts by Name and Code.                                                                                                                                                                     |
| #68 | D58      | A card shows one name; with several people, a **+N Show Names** pill opens the full list on the card, and **Hide Names** closes it. Exports list up to three names.                                                                                                                                                    |
| #69 | D58      | Show/Hide Names is a tinted pill in the card's own text colour.                                                                                                                                                                                                                                                        |
| #70 | D58      | Cards fit their own text (no stretching to the tallest card in the row). The title follows the text style's Bold setting; names are regular weight.                                                                                                                                                                    |
| #71 | D58, D59 | No blank second title line. Expanding/collapsing a branch keeps the view where it was.                                                                                                                                                                                                                                 |
| #72 | D60      | **View-only share links.** HR editors and admins click **Share**, pick 7 days / 30 days / until turned off, and copy a `/share/<token>` link. Anyone with it sees the chart (details, search, zoom, mini-map, PDF/PNG) without signing in. Links can be turned off. Migration `20261019120000_organogram_share_links`. |
| #73 | D55      | Reordering a sub-division keeps the view and moves only its boxes (silent refresh, rows follow saved order).                                                                                                                                                                                                           |
| #74 | D61      | Position cards dragged along their row reorder among their siblings (saved in `Position.displayOrder`).                                                                                                                                                                                                                |
| #75 | D61, D62 | **Drag a card anywhere and its whole branch follows** (one Undo step, saved for everyone and in exports). Dropping onto a sibling swaps them; onto another card or a department heading re-attaches it. Placements saved before 2026-10-19 14:45 UTC are ignored.                                                      |

How Arrange-mode drops now work (D55, D61, D62), in short:

| Drag             | Let go on…                           | Result                            |
| ---------------- | ------------------------------------ | --------------------------------- |
| Department / box | anywhere along its row / a sibling   | reorders; branch follows          |
| Position card    | empty space or its own branch        | moves there with its whole branch |
| Position card    | a sibling card                       | swaps places                      |
| Position card    | any other card / a department header | asks to change the reporting line |

## User manual

- **Version 1.2** (2026-10-09) is the latest. It covers everything up to D54
  but **not D55–D62**. It's a Word file kept **outside the repo**, on the
  original machine: `~/Downloads/DotZero-Organogram-User-Manual.docx`, with
  v1.1 and v1.0 beside it. If you need it on another machine, ask the owner
  for the file.
- Screenshots were made with a temporary Playwright script against the local
  dev server. It isn't kept in the repo. The style is a 1080×675 window at 2×
  scale, with red outlines and numbered red circles.
- Update the manual whenever a screen it shows changes. `docs/HR_USER_GUIDE.md`
  in the repo is up to date through D62 and is a good source.

## Still to do

1. **Security housekeeping (urgent):** the staging database password was
   exposed in a terminal on 2026-10-20.
   - Rotate the Supabase database password.
   - Update `DATABASE_URL` and `DIRECT_DATABASE_URL` in Vercel, then redeploy.
   - Delete the line starting `postgresql://postgres` from `~/.zsh_history`.
   - Delete the old local `.env.staging` if still there (it holds a Vercel
     token).
2. **User manual v1.3** for D55–D62: reordering boxes and cards, moving a
   branch, several people per position and Show Names, sharing links,
   sortable employees, no sub-division codes.
3. **Fill in staging data (in the app):**
   - **Levels:** Delivery Org and Engineering positions have no levels set
     yet; set them on the Positions page.
   - **Shared Backend boxes:** since D56 these people can now all be added to
     the one position instead of one position each:
     - Principal Software Engineer II: M. Fawad, Irfan Mumtaz.
     - Principal Software Engineer: Ghulam Nabi, Waqas Ansari, Zeeshan
       Rasheed, Owais Hassan Zaidi, Haris Ali.
     - Tech Lead: Maha Dev, Affan Younus.
4. **Check department names on staging.** Since D52 names are unique. Older
   data may have two departments with the same name; an import naming one of
   them is refused until one is renamed.
5. **Old separate IT department** (if still there): delete it. The IT
   sub-division under Delivery Org replaces it.
6. **HR Ops sub-division:** the owner asked about deleting it; it still holds
   7 positions, so move or delete those first.
7. **Local test data:** the local Associate Director position
   (`4fd28f29…`) has 3 test assignments added to try Show Names. Remove them
   or refresh local data with `scripts/copy-staging-to-local.ts` (read-only
   on staging).

## How work is done here

- Run the tests and update the specs/docs with every change. Add each
  decision to `docs/DECISIONS.md`.
- Work on a branch, open a PR, and let CI pass **before** merging. Only the
  owner merges (they usually send `gh pr merge <n> …` when ready); never
  enable auto-merge.
- **Checks:**
  - `npm run typecheck`, `npm run lint`, `npm run format:check` (CI fails on
    Prettier), `npm test`
  - `npm run test:integration`. Run it for **any** layout or export change
    too: the export tile-page tests depend on chart size.
  - `npm run test:e2e -- --workers=2` (port 3100). Fewer workers because the
    machine is slow under load.
    - Stop any `npm run dev` first: Next.js allows one dev server per folder.
    - **Known flakes:** the first setup step (`auth.setup.ts`) on a cold
      server, and a few unrelated specs under load. Rerun them on their own
      before treating a failure as real.
    - Drag tests grab a card by its **title**, not its centre (the centre can
      be the Show Names pill).
    - Visual snapshots: `npm run test:e2e -- e2e/organogram-visual.spec.ts --update-snapshots=all`. Review the PNGs before committing.
- **New migration:** add its folder name to `EXPECTED_MIGRATIONS` in
  `lib/db/expected-migrations.ts`. Add new tables to the schema test's
  expected-table list too, in alphabetical order.
- **CI:** jobs run `prisma generate` before the typecheck. The schema is at
  the repo root (`--schema ../prisma/schema.prisma` when run from a subfolder).
- **Never automate drags in Arrange mode** against real data: a drag saves
  card positions or order for everyone.
- **Local one-off scripts not in git:** `scripts/apply-visily-config-to-staging.ts`, `remodel-subdivisions-and-names.ts`, `replace-org-from-csv.ts`, `wipe-positions.ts`. They're kept out on purpose because they can delete or overwrite data. Don't commit or run them casually.

## Running a script against staging

1. The person who owns the password enters it themselves, never in chat.
   - Supabase's connection string contains a literal `[YOUR-PASSWORD]`; fill
     in the real password, URL-encoded.
   - Save the result to `.env.staging.local` as `DATABASE_URL`, git-ignored
     and readable only by the owner (`chmod 600`).
2. Always do a dry run first and get the owner's go-ahead before writing.
3. A round trip from a laptop to the Sydney database takes about 3 seconds.
   Give the script its own `PrismaClient` with
   `transactionOptions: { timeout: 120_000 }` and pass it to the services.
   Prisma's default 5-second transaction timeout otherwise rolls every write
   back.
4. A wrong password shows up as `P1001` ("can't reach database server"), not
   as an authentication error. Don't retry repeatedly; Supabase may block the
   IP.
5. Delete `.env.staging.local` when done.

## Staging migrations

1. **Use the Session pooler**, not the direct host. The direct host
   (`db.<project>.supabase.co`) is IPv6-only and fails with `P1001` from most
   networks. In Supabase: Connect → Session pooler, which looks like
   `postgresql://postgres.<project>:[YOUR-PASSWORD]@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres`.
2. Write `.env.staging.local` with that string (password filled in,
   URL-encoded) as both `DATABASE_URL` and `DIRECT_DATABASE_URL`, `chmod 600`.
   On the original machine, `.staging-tools/staging-migrate-prompt.sh`
   (git-ignored) does this: it asks for the string with the placeholder, then
   the password hidden, and never echoes either. Run it in your own terminal,
   not through an assistant.
3. Run:

   ```bash
   npx dotenv -e .env.staging.local -- npx prisma migrate deploy
   ```

4. Check https://dotzero-organogram.vercel.app/api/health/ready. It flags
   pending migrations only.
5. Delete the env file: `rm .env.staging.local`.

There are 16 migrations as of this handoff, and staging has all of them. The
two added since the last handoff are `20261014120000_multiple_occupants_per_position`
(D56) and `20261019120000_organogram_share_links` (D60). D55, D57–D59, D61 and
D62 needed no migration.
