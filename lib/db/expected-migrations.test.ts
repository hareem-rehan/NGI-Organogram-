import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { EXPECTED_MIGRATIONS, findPendingMigrations } from "./expected-migrations";

describe("EXPECTED_MIGRATIONS", () => {
  it("lists exactly the migrations in prisma/migrations, in order", () => {
    // If this fails after `prisma migrate dev`, add the new migration's
    // folder name to lib/db/expected-migrations.ts — the readiness probe
    // relies on it to notice a database that hasn't been migrated yet.
    const dir = join(process.cwd(), "prisma", "migrations");
    const onDisk = readdirSync(dir)
      .filter((name) => statSync(join(dir, name)).isDirectory())
      .sort();
    expect(EXPECTED_MIGRATIONS).toEqual(onDisk);
  });
});

describe("findPendingMigrations", () => {
  const expected = ["m1", "m2", "m3"];

  it("returns nothing when every expected migration is applied", () => {
    expect(findPendingMigrations(expected, ["m1", "m2", "m3"])).toEqual([]);
  });

  it("returns the missing ones, in order — e.g. the newest one not yet run", () => {
    expect(findPendingMigrations(expected, ["m1", "m2"])).toEqual(["m3"]);
    expect(findPendingMigrations(expected, ["m2"])).toEqual(["m1", "m3"]);
  });

  it("ignores extra migrations the database has beyond what the code needs", () => {
    expect(findPendingMigrations(expected, ["m1", "m2", "m3", "m4-newer"])).toEqual([]);
  });

  it("reports everything pending for an unmigrated database", () => {
    expect(findPendingMigrations(expected, [])).toEqual(expected);
  });
});
