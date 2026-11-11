# Go-Live Checklist — Dynamic Organogram Manager

Status as of **2026-11-11** (refreshed with D68; the Phase 14 version described a project with no staging). Checked = verified with real evidence; unchecked = not done yet, with who or what it is waiting on. Nothing is checked on the strength of a plan alone. Steps are in `docs/DEPLOYMENT_RUNBOOK.md`.

## Ready in the code (verified 2026-11-11)

- [x] **Production build runs.** `npm run build` + `next start` with production-mode settings: the app boots, `/api/health` and `/api/health/ready` are 200, all 16 migrations recognised.
- [x] **Sign-in bypass is off by default in production.** `/dev-sign-in` returns 404 unless `AUTH_ALLOW_DEV_SIGN_IN=true`; the preflight and the deploy pipeline both fail if it is reachable.
- [x] **Security headers on every page.** CSP with per-request nonce, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy (checked on staging and on the local production build). `form-action` also allows the sign-in provider's origin (D68).
- [x] **Production preflight exists** (`npm run preflight:production`, D68): checks settings, database and live site; prints names, never values.
- [x] **Production settings template** (`.env.production.example`).
- [x] **Checks pipeline** on Bitbucket (`bitbucket-pipelines.yml`) — waiting on Pipelines being enabled (below).
- [x] **Critical/High defects = 0** (`docs/DEFECT_REGISTER.md`; DEF-004 accepted, dev tooling only).
- [x] **Zero-duration assignment rule consistent** — a same-day start/end is legal in both the app and the integrity check.

## Staging

- [x] **Staging deployed and in use**: https://dotzero-organogram.vercel.app (Vercel + Supabase, 16/16 migrations).
- [ ] **Real SSO tested on staging.** Waiting on the Google OAuth client (IT). Staging currently uses the sign-in bypass — anyone with the URL is ADMIN — so switch it off as soon as SSO works.
- [ ] **Staging database password rotated** (exposed 2026-10-20). Owner: you (Supabase + Vercel settings).
- [ ] **UAT sign-off** by HR on staging. Owner: to be named.

## Production — waiting on accounts and decisions (see the IT request)

- [ ] **Production Supabase project** (separate from staging), region near Sydney to match `vercel.json` (`syd1`).
- [ ] **Google Workspace OAuth client** with the production redirect URI `https://<domain>/api/auth/callback/company-sso`.
- [ ] **Production domain** decided and DNS pointed at Vercel.
- [ ] **Production settings entered in Vercel** (from `.env.production.example`; nobody pastes secrets into chat).
- [ ] **Migrations applied** to the production database (`prisma migrate deploy`, session pooler).
- [ ] **Preflight READY** with the production settings, then again with `--url` after deploying.
- [ ] **First admin provisioned** after real sign-in works (`npm run auth:provision`).
- [ ] **Backup taken and restored once** (an unrestored backup is an assumption).
- [ ] **Bitbucket Pipelines enabled** for `nextgeni/replit1` (needs a repo admin).
- [ ] **Vercel connected to the Bitbucket repo** (Vercel → Settings → Git); until then deploys come from the old GitHub copy.
- [ ] **Monitoring/alerting** — at least an uptime check on `/api/health/ready`. Provider undecided.
- [ ] **Real data loaded** (CSV import or copy from staging) — only after SSO works.
- [ ] **Owners named**: deployment approver, rollback/restore owner, UAT sign-off.

## Go/No-Go

**No-Go until every production item above is checked.** The code side is ready; what remains is accounts, credentials and decisions that only the company can provide. When they arrive, the order is the "Production, in short" line at the top of `docs/DEPLOYMENT_RUNBOOK.md`.
