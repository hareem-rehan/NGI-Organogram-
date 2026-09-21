# Support Runbook — Dynamic Organogram Manager

Operational reference for whoever provides internal support for this application (help desk, on-call engineer, or an ADMIN acting as first-line support). Every claim below is grounded in the actual error-handling code and the reference guides listed at the end — if something here disagrees with what you observe, trust the code and update this file, per `CLAUDE.md` §1.13.

## 0. What this application is, in one paragraph

An internal Next.js web app, backed by one PostgreSQL database, with **no background job queue and no object-storage service** — uploaded CSV files and generated PDF/PNG exports are stored as bytes directly in Postgres (`ImportJob.rawFile`, `ExportJob.generatedFile`) and cleared once their retention window lapses. Authentication is **Company SSO only** (a provider-neutral OIDC integration) — there are no application-managed passwords anywhere, so "reset the password" is never a valid support step for this app. Sessions are database-backed (not JWT), so a role change or a disable takes effect on the user's very next request, not after some cache/token expiry.

## 1. Sign-in problems

### "I can't sign in at all" / "Access denied"

Work through these in order — each is independently checked, so any one of them alone can block sign-in:

1. **Is the account provisioned?** No self-registration exists. A brand-new email address that has never been provisioned is denied unless `AUTH_AUTO_PROVISION_VIEWERS=true` (and even then, only when exactly one `Company` row exists in the whole database — auto-provisioning refuses rather than guesses if there's more than one). Check with `npm run auth:provision -- list --company <code>`, or ask an ADMIN to check the **Users** screen. If missing, an ADMIN provisions them (`Provision User` on `/users`, or `npm run auth:provision -- add --email <email> --role <ROLE> --company <code>`).
2. **Is the account disabled?** `list` (above) or the Users screen shows status `ACTIVE`/`DISABLED`. A disabled ADMIN is locked out exactly the same as a disabled VIEWER — no role is exempt. Re-enable via the Users screen (**Reactivate**) or `npm run auth:provision -- enable --email <email>`.
3. **Is the email domain on the allow-list?** `AUTH_ALLOWED_EMAIL_DOMAINS` (an env variable, comma-separated) is checked with an exact suffix match on the domain after the `@` — a lookalike domain (`acme-test.evil`, `evilacme.test`) is correctly rejected, not a false positive to chase. If a legitimate user's real domain isn't listed, that's a configuration change, not a per-user fix.
4. **Is a tenant restriction configured and mismatched?** If `AUTH_ALLOWED_TENANT_ID`/`AUTH_OIDC_TENANT_CLAIM` are set, the identity provider's tenant claim must match exactly.
5. **Is the Identity Provider itself reachable?** If `AUTH_OIDC_ISSUER` is unreachable or misconfigured, sign-in fails with a generic _"Something went wrong while signing in"_ message — the raw provider error is never shown to the user, only logged server-side. Check server logs for the actual reason.

The user-facing message tells you which of the above to check next:

| Message the user sees                                                                                                                          | Likely cause                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| "Your account isn't authorized to access this application, or has been disabled. Contact your administrator if you believe this is a mistake." | Unprovisioned (step 1) or disabled (step 2)                                    |
| "Sign-in is temporarily unavailable due to a configuration issue. Please contact your administrator."                                          | A `Configuration`-class error from the OIDC library — check env vars/IdP setup |
| "Your sign-in link has expired or was already used. Please try signing in again."                                                              | A stale/reused verification step — ask the user to retry from scratch          |
| "Something went wrong while signing in. Please try again."                                                                                     | Catch-all (`OAuthSignin`/`OAuthCallback`/unknown) — check server logs          |

None of these messages ever include the raw Auth.js error code or provider detail (`lib/auth/error-messages.ts`'s `safeSignInErrorMessage` is the single place this translation happens) — the specific code is in the server log line for that request, not in anything the user can screenshot for you.

### "I was signed in, then suddenly kicked out" / "My role changed but the app still shows the old one"

This shouldn't happen with any real delay — sessions are database-backed and re-read on every request, so a role change or a disable takes effect on the very next click, not after some cache window. If it seems to persist:

- Confirm the change actually saved (check the Users screen / `auth:provision list` again).
- Ask the user to do a hard refresh — a client-side cached page (not a stale session) is the more likely explanation if the change is confirmed in the database.

### "I signed in but I don't see the menu item I expect"

Check the user's role against `docs/AUTHORIZATION_MATRIX.md` §3. A hidden nav item is enforced server-side too (`requirePagePermission`) — this is never a display bug you can fix by clicking around; it means the role genuinely doesn't have that permission. If the role is wrong, an ADMIN changes it from **Users → Change Role**.

## 2. "I'm locked out and there's no active ADMIN" (recovery)

This should be rare — the application actively prevents it: neither the web **Users** screen nor a self-demotion can ever leave a company with zero active ADMINs (enforced transactionally, race-safe under two simultaneous attempts — `docs/AUTHORIZATION_MATRIX.md` §7, `docs/DECISIONS.md` A29). If you somehow reach this state anyway (e.g. every ADMIN account was disabled by direct database access, bypassing the app), recovery is via the CLI, which has **no such protection of its own** (a deliberate, documented, pre-existing gap — `docs/AUTHORIZATION_MATRIX.md` §7, `docs/DECISIONS.md` A49):

```
npm run auth:provision -- create-admin --email <email> --company <code>
```

or, to re-enable an existing disabled admin:

```
npm run auth:provision -- enable --email <email>
```

Both commands refuse to run against `NODE_ENV=production` unless you pass `--yes-i-am-sure-this-is-production` explicitly — this is intentional; do not treat that flag as routine, only as a deliberate, reviewed action. This CLI path is un-audited (no `AuditEvent` is written for it), which is why it's reserved for genuine break-glass recovery, not everyday role management.

## 3. CSV import problems

Full reference: `docs/CSV_IMPORT_GUIDE.md`. Every stage independently re-checks the `imports:execute` permission, so a VIEWER cannot reach any of this even by guessing a URL.

| Symptom                                                                                                                                           | What's actually happening / what to check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Missing required column(s)" on a file that looks fine                                                                                            | Check the delimiter — only **comma** is supported. A semicolon-delimited file parses as one unrecognized column and fails this way.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| A position/department "doesn't exist" but it's clearly in the file                                                                                | Confirm the code matches exactly (case-insensitive, but otherwise exact) and that it isn't accidentally reusing a code that exists in a _different_ company — cross-company codes never resolve, by design.                                                                                                                                                                                                                                                                                                                                                                                        |
| "This would create a second root position"                                                                                                        | Only one position per company may have no manager. Check for an existing root, or two rows both using `__ROOT__`/leaving the manager blank.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Confirm button stays disabled                                                                                                                     | If `warningRows > 0`, the acknowledgement checkbox must be ticked first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Execute button never appears                                                                                                                      | The job must reach `READY_TO_EXECUTE` (i.e. be confirmed) first — validating alone doesn't unlock execution.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| A field the user expected to update didn't change                                                                                                 | A blank cell means "no change" during an update — the file must use the literal `__CLEAR__` sentinel to explicitly clear a field (see the CSV guide's sentinel table).                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Import ran, but the same user/action shows as "System" in the Audit Log                                                                           | Expected for CSV import's _per-row_ Department/Position/Employee/Assignment events (`docs/DECISIONS.md` A48) — the job-level `IMPORT_EXECUTED` event _is_ attributed to the real user and shares the same correlation ID, so "who ran this import" is always answerable from that event even though individual row changes show `SYSTEM`.                                                                                                                                                                                                                                                          |
| A previously-uploaded file can no longer be executed                                                                                              | Check the job's status — `EXPIRED` after 7 days of inactivity (lazy, on next read, not a background sweep) or already `COMPLETED`/`CANCELLED`/`FAILED`. Re-upload if genuinely needed again.                                                                                                                                                                                                                                                                                                                                                                                                       |
| **A large file (several hundred to ~2,000+ rows) fails outright with a transaction/timeout-shaped error, rather than a normal validation result** | **Known issue (`docs/DEFECT_REGISTER.md` DEF-009, open, not yet fixed).** `executeImportJob` runs the whole batch inside one database transaction with Prisma's default 5-second timeout — a genuinely large batch can exceed that and be rolled back entirely (no partial data is ever left behind; this fails safely, just not usefully at scale). There is no user-facing workaround inside the app today besides splitting the file into smaller batches. Do not spend time re-diagnosing this from scratch — confirm the row count and point to DEF-009 rather than treating it as a new bug. |
| Uploading fails immediately, before any validation                                                                                                | File exceeds 10MB, or more than 5,000 data rows, or a non-`.csv` filename — all rejected before the file's content is even parsed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## 4. PDF/PNG export problems

Full reference: `docs/ORGANOGRAM_EXPORT_GUIDE.md`.

| Symptom                                                                                                               | What's actually happening / what to check                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Export button isn't visible                                                                                           | `exports:execute` is HR_EDITOR/ADMIN only — a VIEWER never sees it, and a direct request would be rejected server-side even if attempted.                                                                                                                                                                                             |
| "Narrow the scope, or export as PNG instead" (PDF)                                                                    | A `MULTI_PAGE_TILED` PDF whose tile grid would exceed 60 pages is rejected before rendering starts, rather than silently generating hundreds of pages. Narrow the scope (Department/Position Focus, or fewer filters) or switch to PNG.                                                                                               |
| PNG export is rejected before it starts                                                                               | The requested scale/scope would exceed the supported pixel/dimension ceiling — never a blank or corrupt file; narrow the scope or use a smaller scale.                                                                                                                                                                                |
| **PNG export of a large chart (roughly 500-1,000+ positions) is very slow (several seconds to ~18 seconds observed)** | **Known, documented performance characteristic (`docs/DEFECT_REGISTER.md` DEF-010, open), not a hang or a bug** — the output is still valid, just slow at that scale. PDF export at the same scope/scale is a working, faster alternative in the meantime.                                                                            |
| A previously-generated export can no longer be downloaded                                                             | Check the job's status — completed exports still expire after their retention window (default 7 days, configurable 1–30 in Settings) even though the job itself is "done"; this is different from an import job, whose retention only ever bounded the _unexecuted upload_. Re-generate if still needed.                              |
| Downloaded file seems to belong to someone else's request                                                             | Cannot actually happen — every download re-runs a full company-scoped, status/expiry-checked lookup; a job id from another company or an expired/cancelled/failed job always resolves to "not found," never returns bytes from elsewhere. If you see this, treat it as a genuine incident, not routine troubleshooting, and escalate. |

## 5. Audit Log questions

Full reference: `docs/AUDIT_AND_ADMIN_GUIDE.md`.

| Symptom                                       | What's actually happening / what to check                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "An event I expect to see is missing"         | First check the active category/action/date-range filters (cumulative). Then check the caller's role — **HR_EDITOR cannot see `USER_ADMINISTRATION`/`COMPANY_SETTINGS`/`SECURITY`/`AUTHENTICATION` events at all**, and the query returns zero results for those rather than an error, so it looks like "nothing happened" rather than "you can't see this." Only ADMIN sees all twelve categories. |
| A date-range search is rejected               | The range is capped at 366 days; narrow it.                                                                                                                                                                                                                                                                                                                                                         |
| Someone asks to edit or delete an audit entry | Not possible for anyone, at any role — enforced at three independent layers (no application function to do it, no UI control, and a database trigger that rejects the raw SQL `UPDATE`/`DELETE` outright, regardless of which database role issues it). This is by design; there is no override.                                                                                                    |

## 6. Settings

| Symptom                                                             | What's actually happening / what to check                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "This record was changed by someone else. Reload and try again."    | Someone else (or another browser tab) saved Settings after this page was loaded — optimistic-concurrency protection working as intended. Reload and retry.                                                                                                                                                                                          |
| A changed Organogram/Export default doesn't seem to affect anything | **Known, documented gap** (`docs/DECISIONS.md` A50) — as of this writing, these defaults are saved, validated, and audited, but the Organogram view and the Export pipeline both still use their own hardcoded defaults rather than reading `CompanySettings`. Not a bug the user is imagining; there is nothing more to troubleshoot on their end. |
| An invalid timezone/retention/depth value is rejected               | Working as intended — timezone must be a real IANA name, expansion depth is bounded 1–10, export retention is bounded 1–30 days.                                                                                                                                                                                                                    |

## 7. General authorization questions

- **"This user can see/do more or less than expected."** Cross-check their exact role against `docs/AUTHORIZATION_MATRIX.md` §3 (the permission matrix) — every permission maps to exactly one of the three roles (VIEWER/HR_EDITOR/ADMIN); there is no fourth role and no per-user override anywhere in this app.
- **"Can a VIEWER reach an admin screen by typing the URL directly?"** No — every route independently re-checks its required permission on the server (`requirePagePermission`) regardless of what the navigation menu shows; an unauthenticated visitor is redirected to sign-in, an authenticated-but-under-privileged one to `/access-denied`.
- **Granting/changing ADMIN or HR_EDITOR** can only happen via the **Users** screen (ADMIN-only) or the `auth:provision` CLI — there is no other request path that can produce either role, by design.

## 8. Infrastructure / dependency failures

- **Health check**: `GET /api/health` returns `{"status":"ok", ...}` when the process is up. **It does not check database connectivity** — a healthy `/api/health` response does not prove Postgres is reachable; if users report the app is broken but `/api/health` is green, check the database directly next.
- **Database unavailable**: the app is designed to fail closed and surface a clear, generic error rather than silently proceeding as if authenticated/authorized or as if a write succeeded. If pages hang or throw generic errors app-wide, check Postgres connectivity/health first.
- **A "Foreign key constraint violated" or similar raw error reaches a user**: this should never happen — every mutation path translates Prisma/database errors into a safe, human-readable message before it reaches the client. If you see a raw stack trace or SQL error surfaced in the UI, treat that as a genuine defect to report, not routine behavior.

## 9. Known, already-tracked issues (don't re-diagnose these from scratch)

These are recorded in `docs/DEFECT_REGISTER.md` — check there for the full detail and current status before spending time re-investigating:

- **DEF-006** (open, not yet fixed) — two hierarchy moves submitted at almost exactly the same instant, by two different HR editors, can in rare cases both succeed even though together they'd form a reporting cycle. Rare in practice; if a reporting cycle is ever discovered in the data, that's the likely root cause. There is no user-facing mitigation today beyond "avoid moving related positions at the exact same time."
- **DEF-009** (open, not yet fixed) — large CSV imports (see §3 above) can fail outright due to a transaction timeout at real scale.
- **DEF-010** (open, not yet fixed) — PNG export of large charts is slow (see §4 above), not broken.
- **DEF-001 / DEF-003** (accepted, non-blocking) — occasional test-environment flakiness under heavy concurrent load; not something end users encounter.
- **DEF-004** (accepted, non-blocking) — known `npm audit` findings in dev-only tooling (Prisma CLI's config loader, Vite's dev server), neither of which ships in the deployed application.
- **DEF-007** (accepted, non-blocking, low severity) — closing a dialog with Escape returns keyboard focus to the top of the page rather than back to the button that opened it; a minor keyboard-navigation inconvenience, not a functional break.

## 10. When to escalate to engineering

Escalate (don't attempt a workaround) if you see:

- A raw stack trace, SQL error, or any provider secret (`AUTH_SECRET`, an OIDC client secret, `DATABASE_URL`) surfaced anywhere in the UI, an error message, or a log a support agent can see.
- Any evidence of cross-company data exposure (someone seeing another company's positions, employees, jobs, or files) — this should be structurally impossible (every query and file download is scoped to the authenticated session's own company), so a genuine occurrence is a serious defect, not routine support.
- A reporting cycle or a "disconnected" position surfaced by the Dashboard's "Data quality" section that doesn't resolve after a manual fix via **Positions → Change Reports-To**.
- Anything not covered above that looks like a data-integrity problem rather than a normal validation rejection.

## 11. Reference documents

- `docs/AUTHORIZATION_MATRIX.md` — roles, permissions, route/server-operation access
- `docs/CSV_IMPORT_GUIDE.md` — full CSV import contract and troubleshooting table
- `docs/ORGANOGRAM_EXPORT_GUIDE.md` — full PDF/PNG export contract
- `docs/AUDIT_AND_ADMIN_GUIDE.md` — audit trail, user administration, settings
- `docs/DEFECT_REGISTER.md` — every known open/accepted defect, with severity and rationale
- `docs/HR_USER_GUIDE.md` — the end-user-facing guide this runbook complements
- `docs/UAT_PLAN.md` — how this application is verified before release
