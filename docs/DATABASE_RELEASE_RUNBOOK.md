# Database Release Runbook — Dynamic Organogram Manager

Phase 13 (Release Hardening) deliverable, Steps 10–11. Documents the migration-deploy procedure and the backup/restore procedure for release day, both **actually rehearsed** against disposable databases during this phase (not merely described) — real commands and real output are captured below, not a hypothetical procedure.

This app has no managed cloud database yet (Phase 14 is deployment; `docs/DECISIONS.md` A7 — "a standard containerized Node.js hosting environment with a managed PostgreSQL instance; no specific cloud provider named"). This runbook is written against that same generic PostgreSQL target — every command here is plain `psql`/`pg_dump`/`pg_restore`/`prisma migrate deploy`, portable to whatever managed Postgres Phase 14 ultimately provisions, not tied to this sandbox's specific Docker setup.

## 1. Migration Deploy Procedure

**Command:** `npm run db:migrate:deploy` (wraps `prisma migrate deploy`) — never `prisma migrate dev` outside a developer's own machine; `migrate dev` can prompt for destructive resets, `migrate deploy` never does.

**Pre-deploy checklist:**

1. Confirm `DATABASE_URL` points at the intended target (staging/production) — never assume the shell's ambient env var; print and eyeball the host/database name before running.
2. Take a fresh backup first (§2 below) — a migration deploy is the single highest-risk moment in a release.
3. Confirm the app's own release regression suite (`docs/RELEASE_CHECKLIST.md`) has passed against a database already on the CURRENT (pre-migration) schema, so any post-migration failure is attributable to the migration itself, not a pre-existing defect.

**Rehearsal actually performed this phase** (against a disposable database, `organogram_migration_rehearsal`, created fresh and dropped after — never a shared/persistent database):

```
$ DATABASE_URL="postgresql://organogram:***@localhost:5433/organogram_migration_rehearsal?schema=public" npx prisma migrate deploy

5 migrations found in prisma/migrations

Applying migration `20260901094021_init`
Applying migration `20260901102848_add_auth_models`
Applying migration `20260902064230_add_import_models`
Applying migration `20260902121430_add_export_models`
Applying migration `20260902153408_add_audit_admin_settings`

All migrations have been successfully applied.
```

All 5 migrations (the project's complete history, Phase 1 through Phase 12) applied cleanly, in order, against a completely empty database, with zero manual intervention. Re-running the identical command a second time (simulating a redeploy of the same release, or a deploy step that runs twice) correctly reported **"No pending migrations to apply" / "Database schema is up to date!"** — the deploy step is safely idempotent.

**Post-deploy verification performed** (not merely "no error thrown" — the hand-authored, non-Prisma-DSL-expressible constraints were independently confirmed present):

```
$ psql -c '\d positions'
    "positions_one_root_per_company" UNIQUE, btree ("companyId") WHERE "primaryReportsToPositionId" IS NULL
Check constraints:
    "positions_no_self_report" CHECK ("primaryReportsToPositionId" IS NULL OR "primaryReportsToPositionId" <> id)

$ psql -c "SELECT tgname FROM pg_trigger WHERE tgrelid = 'audit_events'::regclass AND NOT tgisinternal;"
 audit_events_no_update
 audit_events_no_delete
```

Then proved the audit-immutability trigger actually enforces its rule, not just that it exists — inserted one real `audit_events` row and attempted both an `UPDATE` and a `DELETE` against it:

```
UPDATE audit_events SET "entityType" = 'Hacked' WHERE "entityType" = 'Test';
ERROR:  audit_events is append-only: UPDATE is not permitted on this table

DELETE FROM audit_events WHERE "entityType" = 'Test';
ERROR:  audit_events is append-only: DELETE is not permitted on this table
```

Both rejected, exactly as `docs/adr/0015-audit-event-model-and-immutability.md` specifies.

**Rollback approach:** Prisma's `migrate deploy` has no built-in "down" migration mechanism (by design — see Prisma's own migration philosophy). This project's rollback strategy is **restore-from-backup**, not a reverse migration script:

- If a migration deploy fails partway through, `prisma migrate deploy` records the failed migration as failed in its `_prisma_migrations` tracking table and refuses to proceed further — it does NOT leave the schema silently half-migrated without a record. The fix is: restore the pre-deploy backup (§2), diagnose the migration SQL offline against a disposable copy, fix it, and re-attempt.
- If a migration deploy succeeds but the new application code reveals a functional problem, the safe rollback is again restore-from-backup to the pre-deploy snapshot, then redeploy the previous application version — not attempting to hand-write a reverse migration under release pressure.
- This is why §2's backup rehearsal is not optional scaffolding around the migration step — it **is** the rollback mechanism.

## 2. Backup / Restore Procedure

**Tooling:** standard `pg_dump`/`pg_restore` in custom format (`-Fc`) — portable to any Postgres host, not tied to a specific managed-database vendor's proprietary snapshot feature (Phase 14 may layer a provider-specific automated-snapshot feature on top of this; this procedure is the vendor-neutral floor every Postgres provider supports).

**Backup command:**

```
pg_dump -U <user> -d <database> -Fc -f <backup-file>.dump
```

**Restore command (into an empty, freshly-created database):**

```
pg_restore -U <user> -d <database> --no-owner --no-privileges <backup-file>.dump
```

**Rehearsal actually performed this phase** (against a disposable database, `organogram_backup_rehearsal`, seeded with one representative company/department/position, dumped, the database fully dropped and recreated empty — a genuine "the database is gone" disaster simulation, not merely a truncate — then restored):

1. Seeded row counts before backup: `companies=1, departments=1, positions=1`.
2. `pg_dump -Fc` succeeded, exit code 0, producing a 58,464-byte dump file.
3. Database fully dropped (`DROP DATABASE`) and recreated empty (`CREATE DATABASE`).
4. `pg_restore --no-owner --no-privileges` succeeded, exit code 0.
5. Row counts after restore: **`companies=1, departments=1, positions=1`** — an exact match.
6. The hand-authored constraints (`positions_one_root_per_company`, `positions_no_self_report`) and the audit-immutability triggers (`audit_events_no_update`, `audit_events_no_delete`) were independently re-verified present on the restored database — a dump/restore cycle preserves constraints and triggers, not just row data.
7. The restored data was queried through the application's own Prisma client (not just raw `psql`), confirming a real `Company`→`Department` relation resolved correctly end-to-end post-restore — proof the restored database is actually usable by the app, not merely structurally present.

**`--no-owner --no-privileges` is deliberate:** the rehearsal restore target may be owned by a different database role than the original dump's role (exactly the situation a real disaster-recovery restore onto a freshly-provisioned instance would face) — these flags let the restore proceed without requiring the exact same role to already exist on the target, then the target database's own default owner/grants apply. Re-apply any custom grants separately if the production environment relies on non-default ones (none exist in this app today — one shared application role, per `docs/DECISIONS.md`'s existing single-role setup, `docs/DECISIONS.md` A51).

**Retention/scheduling:** not yet defined — this is a Phase 14 (deployment) operational concern (backup frequency, retention window, and off-host storage depend on the actual hosting provider chosen, none of which has been selected yet per A7). This runbook proves the mechanism works; Phase 14 must decide the schedule and storage location.

## 3. What This Rehearsal Does NOT Cover (honestly disclosed, not silently skipped)

- **Point-in-time recovery (WAL-based continuous archiving)** was not rehearsed — this sandbox's Postgres container is not configured for WAL archiving, and no production hosting target exists yet to configure it against. `pg_dump`/`pg_restore` (rehearsed above) gives a full logical backup/restore capability today; continuous point-in-time recovery is a Phase 14 decision once a specific managed-Postgres provider (with its own PITR feature, e.g. RDS snapshots or a managed WAL-archiving service) is chosen.
- **Restore under production load / large-data-volume timing** was not measured — the rehearsal database held 3 rows, deliberately (a migration/constraint-correctness rehearsal, not a performance rehearsal). See `docs/PERFORMANCE_REPORT.md` for data-volume performance testing; a large-scale backup/restore timing rehearsal is recommended before the actual Phase 14 go-live, once real expected data volumes are known.
- **Cross-version Postgres upgrade compatibility** was not tested — both the source and target in this rehearsal were the same `postgres:16-alpine` image.
