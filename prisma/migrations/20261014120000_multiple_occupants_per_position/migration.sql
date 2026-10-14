-- Several employees may hold one position at the same time (docs/DECISIONS.md
-- D56, supersedes the "one occupant per position" half of P2). Drop the
-- partial unique index that allowed only one open primary assignment per
-- position. "One open primary position per employee" stays enforced by
-- position_assignments_one_open_primary_per_employee.
DROP INDEX IF EXISTS "position_assignments_one_open_primary_per_position";
