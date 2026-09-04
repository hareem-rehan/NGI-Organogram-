# Hypercare Plan — Dynamic Organogram Manager

**Status: TEMPLATE — hypercare has not started, because production has not launched.** This document is written now so it's ready the moment a real go-live happens; nothing below describes something that has already occurred.

## Ownership (currently unassigned — fill in before go-live)

| Role                                       | Owner | Status                   |
| ------------------------------------------ | ----- | ------------------------ |
| Business contact                           | —     | **Not assigned ("NAN")** |
| Technical contact                          | —     | **Not assigned**         |
| Deployment approver                        | —     | **Not assigned ("NAN")** |
| UAT sign-off owner                         | —     | **Not assigned ("NAN")** |
| Backup/restore and rollback decision owner | —     | **Not assigned ("NAN")** |

Hypercare cannot meaningfully begin without at least a business and technical contact named — this table is the first thing to fill in, not an afterthought.

## Hypercare duration

Recommend **10 business days** from go-live (a common, reasonable default for an internal HR tool with a small, known user base) — not yet agreed with the user; adjust once an owner is named.

## Daily activities during hypercare

- **Daily health review:** `/api/health`, error rate, and the audit log's `IMPORT_FAILED`/`EXPORT_FAILED`/`UNAUTHORIZED_ACCESS_ATTEMPT` events for the previous 24 hours.
- **Import/export review:** any CSV import or PDF/PNG export failures, reviewed for whether they're user error (a malformed file) or a real defect.
- **SSO issue process:** a user unable to sign in is first checked against `AUTH_ALLOWED_EMAIL_DOMAINS`/tenant restriction (expected, correct rejection of an external user) before being treated as a bug.
- **Hierarchy-data issue process:** any HR-reported "the chart looks wrong" report is checked against `npm run check:integrity` (the domain-integrity checker, Phase 13) before assuming a code defect — most such reports trace to a data-entry mistake the checker won't even flag (it only catches structural corruption, not "wrong" title text), which is a normal HR correction, not an incident.

## Escalation matrix (template — severities per `docs/DEFECT_REGISTER.md`)

| Severity                                                        | Response expectation             | Escalates to                                                                      |
| --------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------- |
| Critical (auth bypass, cross-company exposure, data corruption) | Immediate — treat as an incident | Technical contact, then rollback decision owner                                   |
| High (authz bypass, major feature unusable)                     | Same business day                | Technical contact                                                                 |
| Medium/Low                                                      | Tracked normally, no page-out    | Standard defect-tracking process (not yet chosen — see `docs/SUPPORT_RUNBOOK.md`) |

## Rollback authority

Per `docs/DEFECT_REGISTER.md`'s severity definitions and this project's standing rules: **only the named rollback decision owner** may authorize a database restore (as opposed to a forward-fix or an application-artifact rollback, which is lower-risk and reversible). No automatic restore is ever triggered by monitoring alone. This owner is currently unassigned.

## Handover-exit criteria

Hypercare ends when: the agreed duration has elapsed with no unresolved Critical/High incident, daily health reviews have found nothing requiring escalation for at least 3 consecutive business days, and the named technical/business contacts confirm they're comfortable operating without daily oversight. None of this has started — there is no go-live date yet.
