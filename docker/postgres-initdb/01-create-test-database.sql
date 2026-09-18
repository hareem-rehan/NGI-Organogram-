-- Runs once, automatically, when the postgres container's data volume is
-- first initialized (standard docker-entrypoint-initdb.d behavior).
-- Creates a SEPARATE database for integration tests so test runs never
-- touch the same database a developer might be poking at manually via
-- `npm run dev`/Prisma Studio. See docs/DECISIONS.md and
-- docs/phase-reports/PHASE_02_DATABASE_AND_DOMAIN.md for the full
-- test-database isolation strategy.
CREATE DATABASE organogram_test OWNER organogram;
