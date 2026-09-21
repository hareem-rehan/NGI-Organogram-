# ADR-0011: Three-role RBAC model (ADMIN / HR_EDITOR / VIEWER) and CLI-only provisioning

## Status

Accepted (Phase 3). Amends Confirmed Decision C14.

## Context

Phase 0's Confirmed Decision C14 (`docs/DECISIONS.md`) recorded a four-role model taken directly from the proposal: Super Admin, HR Admin, HR Viewer, Employee Viewer. The Phase 3 task brief specified a different, three-role fallback — ADMIN, HR_EDITOR, VIEWER — with per-role responsibilities, explicitly framed as the model "if no final roles exist." No final HR-confirmed role list exists (`docs/DECISIONS.md` never recorded one), so this fallback is the authoritative current model, and its adoption is a genuine, documented amendment to C14 — not a silent substitution.

Separately, because there is no credentials provider (ADR-0010), nobody can "sign up" — every account that is allowed to exist has to be created by some out-of-band, trusted action. The task brief required that ADMIN and HR_EDITOR can _only_ be granted this way, and that auto-provisioning (if enabled at all) can only ever grant VIEWER.

## Decision

1. **Three roles**, defined once in `lib/auth/permissions.ts` as the source of truth for both the role enum (`prisma/schema.prisma`'s `UserRole`) and the permission grants:
   - `VIEWER` — read-only: dashboard, organogram, departments/positions/employees views.
   - `HR_EDITOR` — VIEWER's grants plus manage departments/positions/employees, execute imports/exports, view the audit log.
   - `ADMIN` — HR_EDITOR's grants plus manage users and settings.
     Permissions are a flat, named set (`Permission` union type) rather than free-form strings, so a typo'd permission name is a compile error, not a silent no-op.
2. **Deny-by-default evaluation.** `permissionsForRole(role)` returns an empty set for `null`/`undefined`/any value outside the three known roles — there is no "unknown role gets some grants" path. A role that somehow reaches the app without matching one of the three enum members is treated as having zero permissions, not as an error to work around.
3. **No self-service path to any role.** There is no UI control, API route, or auto-provisioning path that can create or promote a user to `ADMIN` or `HR_EDITOR`. The only way to grant those roles is `scripts/provision-user.ts`, a CLI tool run by someone with direct database/deploy access — the same trust boundary as "who can run a migration."
4. **Auto-provisioning, if enabled, can only ever create `VIEWER`s**, and only under narrow, explicit conditions (`lib/services/user.service.ts`'s `resolveOrProvisionUserForSignIn`):
   - `AUTH_AUTO_PROVISION_VIEWERS` must be `"true"` (default `"false"` — deny-by-default at the config level too).
   - The signing-in identity must already have passed the domain/tenant checks (ADR-0010).
   - Exactly one `Company` must exist in the database — if zero or more than one exist, provisioning is refused (`unprovisioned`), because there is no safe way to guess which company a brand-new user belongs to. This is the same "ambiguous state, refuse rather than guess" posture as the hierarchy-safety rules in `CLAUDE.md` §2.
5. **`scripts/provision-user.ts`** is the only user-management surface in Phase 3 (there is deliberately no admin UI for user management yet — that's out of this phase's scope). It supports `create-admin`, `add` (any role), `set-role`, `disable`, `enable`, `list`, and refuses every mutating command under `NODE_ENV=production` unless `--yes-i-am-sure-this-is-production` is passed explicitly — a guard against an accidental production run modeled on Prisma's own AI-agent consent guard for `migrate reset`.
6. **Disabling a user (`status: DISABLED`) is enforced independently of role.** A disabled `ADMIN` is still fully blocked — `requireActiveUser`/`requirePermission` check status before role, every time, on every request (see ADR-0012).

## Rationale

- A flat, closed permission set (rather than ad-hoc string checks scattered through route handlers) makes "does role X have permission Y" a single, unit-tested pure function (`lib/auth/permissions.test.ts`), reusable identically for nav filtering, page guards, and future server-action authorization.
- Restricting ADMIN/HR_EDITOR grants to an out-of-band CLI (never a code path reachable from an authenticated request) means there is no request — malicious or buggy — that can ever grant elevated access to itself or anyone else. The blast radius of a bug in the web-facing auth code is capped at "grant VIEWER," never "grant ADMIN."
- The "exactly one company" auto-provisioning guard exists because this schema is deliberately multi-tenant-ready (`docs/DECISIONS.md` T10) even though the MVP runs single-company — auto-assigning a new user to an arbitrary company the moment a second one exists would be a real security bug, not a hypothetical one.

## Alternatives Considered

- **Keep the four-role model from C14 (Super Admin / HR Admin / HR Viewer / Employee Viewer):** rejected — the task brief explicitly specified the three-role fallback with its own permission responsibilities; keeping the old model would silently ignore the current, more specific instruction. Recorded as an explicit C14 amendment rather than done quietly.
- **Allow auto-provisioning to assign HR_EDITOR based on a claim (e.g. a group claim from the IdP):** rejected for MVP — no such mapping was specified, and inventing one risks over-granting access based on an IdP-side group that wasn't vetted for this specific meaning; CLI-only elevation is the safer default per `docs/DECISIONS.md` §5.
- **Build a web-based user-management screen this phase:** explicitly out of scope — the task brief's role/provisioning section describes a CLI tool, and `CLAUDE.md` §1.4 forbids pulling forward work not in the current phase's scope.

## Consequences

- Onboarding a new ADMIN or HR_EDITOR always requires someone with CLI/deploy access to run a command — there is no in-app "invite a colleague" flow yet. This is a real, documented limitation (see the Phase 3 report's "Known Limitations"), not an oversight.
- If a future phase adds an in-app user-management UI, it must call through the same `role`-mutation path `scripts/provision-user.ts` uses today (or a service function extracted from it) and must re-apply the same "grant VIEWER only, never elevate" default unless a subsequent, explicit decision changes that.
- `docs/AUTHORIZATION_MATRIX.md` is the single reference for the full role → permission → route → server-operation mapping this ADR establishes; keep it in sync with `lib/auth/permissions.ts` if either changes.
