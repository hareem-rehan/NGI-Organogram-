# Post-MVP Backlog — Dynamic Organogram Manager

Deferred capabilities, none implemented and none to be implemented as part of deployment (CLAUDE.md's MVP Exclusions, restated here for a single reference point). Recording this list is documentation only — it is not an implementation plan, priority order, or commitment.

- **Dotted-line / secondary reporting.** `PositionAssignment.isPrimary` is already reserved for this in the schema (Phase 2) but no dotted-line logic exists anywhere.
- **Graphical drag-and-drop hierarchy editing.** All hierarchy changes go through explicit forms/dialogs today (`docs/DECISIONS.md`).
- **Approval workflow for organizational changes.** Every mutation applies immediately once submitted by an authorized role; no multi-step approval/review exists.
- **Future-effective organization planning** (scheduling a hierarchy change to take effect on a future date).
- **Historical snapshots** of the organogram at a past point in time — the audit log records every change but there is no "view the chart as of date X" feature.
- **HRMS integration** — CSV import/export is the only data interchange mechanism; no live system-to-system sync exists.
- **Advanced workforce analytics** beyond the Dashboard's existing summary metrics.
- **Custom roles** beyond the fixed `VIEWER`/`HR_EDITOR`/`ADMIN` set.
- **Additional export formats** — only PDF and PNG exist; the `exports:execute` permission's broader description ("PDF/PNG/CSV export") is not yet fully realized — CSV export is not implemented (a known, documented gap, distinct from CSV _import_, which is).
- **Multilingual support**, if required — the UI is English-only today.
- **Notification workflows** (email/in-app notifications on hierarchy changes, import completion, etc.) — none exist.
- **Advanced department grouping** beyond the current single-parent department hierarchy.

Also carried forward from earlier phases' own documented deferrals, for completeness:

- A true async/background-job execution model for CSV import and PDF/PNG export (Phase 13.1 explicitly chose a bulk-write optimization within the existing synchronous-request model over building this, given no queue infrastructure exists yet — see `docs/phase-reports/PHASE_13_1_PERFORMANCE_REMEDIATION.md`).
- Bulk-optimizing hierarchy MOVE operations in CSV import (only CREATE rows were bulk-optimized in Phase 13.1; UPDATE/move rows remain per-row).
- Atomic root-position swap within a single CSV import file (DEF-011, `docs/DEFECT_REGISTER.md`) — a documented two-step workaround exists.
