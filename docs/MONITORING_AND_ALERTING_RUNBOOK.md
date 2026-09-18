# Monitoring and Alerting Runbook — Dynamic Organogram Manager

**Status: PLAN, not an active configuration.** No monitoring or alerting provider is connected to this application today (`docs/DEPLOYMENT_DECISIONS.md` #18, undecided). This document describes what should be monitored and how, so that once a real hosting/monitoring stack exists, standing it up is a configuration exercise against this plan, not a design exercise from scratch.

## What the application already gives you, with no extra setup

- **`GET /api/health`** — returns `{status, application, environment, timestamp, version}`. Confirmed this phase (Phase 14) to correctly report `environment: "production"` and the real app version under a production build, with no configuration leakage. This is the natural target for an uptime/health check once one is connected.
- **Structured logs via `lib/logger.ts`**, respecting `LOG_LEVEL` (`docs/ENVIRONMENT_MATRIX.md`) — written to stdout, which Vercel's platform captures automatically once a real Vercel project exists. No secret or token is ever passed to a log call (verified as part of Phase 13's security review).
- **The audit log itself** (`AuditEvent`, Phase 12) — not a substitute for infrastructure monitoring, but the authoritative record of every mutating action, already redacted and immutable (DB-trigger-enforced). Reviewing it is part of the daily/weekly operational routine described in `docs/HYPERCARE_PLAN.md`, not something a metrics dashboard replaces.

## What to monitor, once a real environment exists

| Signal                                                                    | Why it matters                                    | Source                                                                                                                                                        |
| ------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application availability / health-check failures                          | Basic uptime                                      | `GET /api/health`, polled by the hosting platform or an external uptime checker                                                                               |
| Error rate (5xx responses, unhandled exceptions)                          | User-facing breakage                              | Platform request logs / an APM tool if one is added                                                                                                           |
| Response latency (p50/p95)                                                | Perceived performance regression                  | Platform request logs / APM                                                                                                                                   |
| Authentication failures (rate, not individual events)                     | Possible credential-stuffing or misconfigured SSO | Auth.js sign-in error logs                                                                                                                                    |
| Unauthorized-access spikes (`ForbiddenError`/`UnauthenticatedError` rate) | Possible probing or a broken permission check     | Application logs (`lib/logger.ts`)                                                                                                                            |
| Database connection count / errors                                        | Connection-pool exhaustion                        | Managed Postgres provider's own metrics, once chosen                                                                                                          |
| Database storage growth                                                   | Capacity planning                                 | Managed Postgres provider's own metrics                                                                                                                       |
| Import/export job failure rate                                            | A broken CSV pipeline or export renderer          | `ImportJob`/`ExportJob` status counts — no dedicated metric exists yet; the audit log (`IMPORT_FAILED`/`EXPORT_FAILED` events) is the current source of truth |
| Application restarts / crash loops                                        | Deployment or resource problem                    | Hosting platform                                                                                                                                              |

**Not applicable, by architecture, until a future phase changes it:** background-job failures, stuck jobs, cleanup-job failures, storage failures — none of these exist as separate concerns today, since there is no background worker and no separate storage service (see `docs/ENVIRONMENT_MATRIX.md`).

## Alert design, once a provider is chosen

Every alert this app eventually defines should carry: severity, threshold, duration (avoid alerting on a single blip), an owner, an escalation path, and a link back to this runbook or the relevant section of `docs/SUPPORT_RUNBOOK.md`. None is defined yet — there is no owner to assign one to (`docs/DEPLOYMENT_DECISIONS.md`).

## Non-negotiable constraints (apply regardless of which provider is eventually chosen)

1. **No employee PII in alert payloads.** An alert should say "3 export failures for company X in the last 5 minutes," never include a person's name/email.
2. **No secret or token ever appears in a log line or an alert.** Already true today by construction (`lib/logger.ts`'s callers never receive `AUTH_SECRET`/`AUTH_OIDC_CLIENT_SECRET`/`DATABASE_URL` — verified in Phase 13's security review); this constraint carries forward to whatever monitoring tool is added.
3. **Production log level must stay at `info` or `warn`**, never `debug` — `debug` is more likely to include verbose request/response payloads.
4. **A monitoring/alerting outage must never expose the application publicly** — i.e., monitoring must be additive observability, never a gate the application depends on to function correctly.
