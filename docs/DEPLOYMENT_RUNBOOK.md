# Deployment Runbook

Step-by-step instructions to take DotZero Organogram from "runs on a laptop" to a working staging environment, and then to production.

**Read this first:** sections 1–4 are account-level setup that only a person with your Google and Vercel identities can do. They cannot be automated or delegated — they involve creating accounts and entering credentials. Everything from section 5 onward is ordinary engineering work.

Nothing in this runbook has been executed yet. Every command is written to be run by you, in your own terminal or browser.

---

## Before you start

| Fact            | Value                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| Hosting         | Vercel (`docs/DEPLOYMENT_DECISIONS.md` #1)                                                                      |
| SSO provider    | Google Workspace (#12)                                                                                          |
| Auth model      | **SSO only** — there is no password login anywhere, by design (`docs/adr/0010-authjs-provider-neutral-oidc.md`) |
| Database        | PostgreSQL 16, 5 migrations, managed provider **not yet chosen** (#5)                                           |
| Deploy pipeline | `.github/workflows/deploy.yml` — functional, but fails until sections 1–4 are done                              |

⚠️ **The single most important consequence of SSO-only auth:** until section 3 is finished, a deployed site rejects _every_ sign-in, including yours. There is no fallback login. Do not deploy expecting to "sort auth out afterwards".

---

## 1. Vercel project (~5 minutes)

```bash
vercel login
```

Then, from the repository root:

```bash
vercel link
```

Accept the prompts to create a new project. This writes a `.vercel/` directory locally (already gitignored).

Capture the two identifiers the pipeline needs:

```bash
cat .vercel/project.json
```

Record `orgId` and `projectId` — they become `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` in section 4. Neither is secret, but both are required.

Finally, create a deploy token at **Vercel → Account Settings → Tokens**. That value _is_ secret; it becomes `VERCEL_TOKEN`.

---

## 2. Managed PostgreSQL (~10 minutes)

Provision **two** databases — staging and production. Never point staging at the production database; the pipeline runs migrations against whatever `DATABASE_URL` the environment provides.

Lowest-friction option is Vercel's own Postgres (or Neon) from the same dashboard, since it wires the connection string in for you. Any managed Postgres 16 works.

For each database, record its connection string. Then apply the schema:

```bash
# Staging
DATABASE_URL="<staging connection string>" npx prisma migrate deploy

# Production
DATABASE_URL="<production connection string>" npx prisma migrate deploy
```

Expected output: `5 migrations found` and all applied. This is safe to re-run — `migrate deploy` only applies committed migrations and never resets anything.

Then record which provider you chose in `docs/DEPLOYMENT_DECISIONS.md` (#5), which is currently blank.

---

## 3. Google Workspace OAuth client (~10 minutes)

In **Google Cloud Console → APIs & Services → Credentials → Create Credentials → OAuth client ID**:

- Application type: **Web application**
- Authorised redirect URI: `https://<your-domain>/api/auth/callback/company-sso` — add one per environment (the staging URL from section 5, and later the production domain)

The final path segment is the provider id `OIDC_PROVIDER_ID` from `lib/auth/config.ts`. It is **`company-sso`, not `oidc`** — get it wrong and Google rejects the sign-in with a redirect-URI mismatch.

This yields a **Client ID** and **Client Secret**.

### The two settings that will silently break this if you miss them

**`AUTH_OIDC_TENANT_CLAIM` must be `hd`.** It defaults to `tid`, which is _Microsoft Entra's_ claim name. Google Workspace uses `hd` (hosted domain). Leave the default in place and tenant validation will not behave as intended. See `lib/env.ts` and `docs/ENVIRONMENT_MATRIX.md`.

**`AUTH_ALLOWED_EMAIL_DOMAINS` must be your real domain** (e.g. `nextgeni.com`). This is the allowlist deciding who may sign in at all.

### Generate the session secret

Run this yourself and paste the result directly into Vercel — do not share it, and do not paste it into a chat or commit it:

```bash
openssl rand -base64 32
```

That value is `AUTH_SECRET`. Use a **different** one for staging and production.

---

## 4. Environment variables and GitHub Environments (~10 minutes)

### 4a. Vercel environment variables

In **Vercel → Project → Settings → Environment Variables**, add these for both Preview (staging) and Production:

| Variable                      | Value                                                            |
| ----------------------------- | ---------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_NAME`        | `DotZero Organogram`                                             |
| `DATABASE_URL`                | The matching database from section 2                             |
| `AUTH_SECRET`                 | From section 3 — different per environment                       |
| `AUTH_OIDC_ISSUER`            | `https://accounts.google.com`                                    |
| `AUTH_OIDC_CLIENT_ID`         | From section 3                                                   |
| `AUTH_OIDC_CLIENT_SECRET`     | From section 3                                                   |
| `AUTH_OIDC_TENANT_CLAIM`      | `hd` ← **not the default**                                       |
| `AUTH_ALLOWED_EMAIL_DOMAINS`  | Your real domain                                                 |
| `AUTH_PROVIDER_NAME`          | e.g. `Google Workspace` (shown on the sign-in button)            |
| `AUTH_AUTO_PROVISION_VIEWERS` | `false` unless you want anyone in the domain auto-granted VIEWER |
| `AUTH_TRUST_HOST`             | `true`                                                           |

`AUTH_TRUST_HOST` is not optional paranoia: production mode genuinely rejected requests with an `UntrustedHost` error during Phase 14 until it was set.

`NODE_ENV` is set to `production` by Vercel automatically. Do not override it — the dev sign-in backdoor is gated on exactly that value.

### 4b. GitHub Environments

In **Settings → Environments**, create `staging` and `production`. Add to each:

| Secret              | Notes                                                                                |
| ------------------- | ------------------------------------------------------------------------------------ |
| `VERCEL_TOKEN`      | From section 1                                                                       |
| `VERCEL_ORG_ID`     | From section 1                                                                       |
| `VERCEL_PROJECT_ID` | From section 1                                                                       |
| `DATABASE_URL`      | The matching database — **double-check you have not pasted production into staging** |

On the **`production`** environment, also set **Required reviewers** to your named deployment approver. That protection rule _is_ the manual approval gate; it is enforced by GitHub, not by anything in the workflow file, so it cannot be bypassed by editing YAML.

`docs/DEPLOYMENT_DECISIONS.md` #19 currently records the approver as `NAN`. Name a person before this step.

---

## 5. First staging deployment

**GitHub → Actions → Deploy → Run workflow → target: `staging`.**

The pipeline will:

1. Run the full quality gate (`ci.yml`: lint, typecheck, unit, integration, secret scan, integrity check, build, Playwright)
2. Apply migrations to the staging database
3. Build and deploy to Vercel
4. Verify `/api/health` returns 200
5. Verify `/dev-sign-in` returns **404** — proving the local-testing backdoor did not ship

If step 5 fails, treat it as a security incident, not a flaky test.

### Then verify SSO by hand

**This has never been done.** Every sign-in to date has used a seeded session cookie, never a real identity provider. Open the staging URL and sign in with a real Google Workspace account. Confirm:

- Sign-in succeeds and lands on the dashboard
- An address _outside_ `AUTH_ALLOWED_EMAIL_DOMAINS` is **rejected**
- Your role is correct (the first user needs provisioning — see `scripts/provision-user.ts`)

---

## 6. Before production

Do not skip these. They are the difference between a deployment and an outage you cannot undo.

- [ ] Name the three owners still recorded as `NAN`: deployment approver, UAT sign-off, rollback/restore owner
- [ ] Run the manual smoke suite in `docs/GO_LIVE_CHECKLIST.md` against staging
- [ ] HR UAT sign-off on staging
- [ ] **Take a backup and actually restore it.** An unrestored backup is an assumption, not a backup. Restoring it is the only proof.
- [ ] Configure monitoring/alerting (`docs/MONITORING_AND_ALERTING_RUNBOOK.md`) — provider still undecided (#18)
- [ ] Decide the production domain and point DNS at Vercel
- [ ] Plan the real data migration — CSV import is the only path in (`docs/DECISIONS.md` P6)

---

## 7. Production deployment

**GitHub → Actions → Deploy → Run workflow → target: `production`, `backup_verified: yes`.**

The run pauses for the required reviewer to approve. It refuses to proceed unless `backup_verified` is exactly `yes` — a deliberate human checkpoint, because no automated check can prove a backup is _restorable_.

### Rollback

```bash
vercel rollback <previous-deployment-url>
```

or promote the previous deployment from the Vercel dashboard.

⚠️ **A rollback reverts code only.** It does not undo an applied database migration. If a migration is the problem, you need the database restore path and the named rollback owner — which is exactly why section 6 requires a _rehearsed_ restore.

---

## Known gaps this runbook does not close

Honest list of things still open after a successful production deploy:

- **Company settings have no effect.** `CompanySettings` organogram/export defaults are saved and audited but never read by the organogram view or export service (`docs/DECISIONS.md` A50). A user changing a default sees nothing happen.
- **Scale is an assumption.** The ~2,000-position design target (P7) is unconfirmed and load-bearing: organogram reads cap at 2,000, export at 2,500, and search/filter run client-side over the whole array.
- **The zero-duration assignment rule is contradictory.** `lib/domain/assignment.ts` permits `endDate == startDate`; `lib/domain/integrity-check.ts` calls it a release-blocking violation. `npm run check:integrity` will fail on real data the app itself creates until this is decided one way or the other.
- **E2E flakiness under parallel load** (DEF-001) — reproducible at default worker count, clean at `--workers=2`.
- **500-node PDF export** exceeds its 6,000 ms threshold (measured ~6,400 ms before recent changes, ~6,700 ms after). Pre-existing, unrelated to DEF-010's PNG limits.
