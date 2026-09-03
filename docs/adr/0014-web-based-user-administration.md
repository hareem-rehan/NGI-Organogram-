# ADR-0014: Web-based user administration (amends ADR-0011)

## Status

Accepted (Phase 12). Amends [ADR-0011](0011-rbac-and-provisioning.md).

## Context

ADR-0011 (Phase 3) deliberately restricted granting `ADMIN`/`HR_EDITOR` — and disabling/enabling any user — to `scripts/provision-user.ts`, an out-of-band CLI requiring deploy/database access, with this explicit forward guidance: "Adding an in-app user-management UI: must reuse the same 'grant VIEWER only via auto-provisioning, everything else CLI-only' default from ADR-0011 unless a subsequent, explicit decision changes it — don't silently loosen this while building the UI."

The Phase 12 task brief explicitly and repeatedly requires exactly that in-app capability: provisioning SSO users with any role, changing roles, disabling/reactivating users, and linking a `User` to an `Employee`, all through an `ADMIN`-only web UI, with a documented rationale for why this is safe.

## Decision

Add a second, in-app path to grant/change `ADMIN`/`HR_EDITOR`/`VIEWER` and disable/reactivate users — `lib/services/user-admin.service.ts`, exercised only via `app/(app)/users/actions.ts` and gated by `requirePermission("users:manage")`. The CLI (`scripts/provision-user.ts`) is preserved unchanged, per CLAUDE.md §1.2 ("preserve existing conventions and completed functionality").

This is safe, and not a reintroduction of the risk ADR-0011 closed, because:

1. **The new path is reachable only by an already-authenticated `ADMIN`.** `ADMIN` itself remains grantable only via the CLI (there is still no request path — auto-provisioning, sign-in, or otherwise — that can produce an `ADMIN`/`HR_EDITOR` from nothing). The web UI is a capability an _existing, trusted_ `ADMIN` exercises on their own already-earned privilege, not a new way for an untrusted request to acquire privilege. ADR-0011's actual guarantee ("the blast radius of a bug in the web-facing auth code is capped at 'grant VIEWER,' never 'grant ADMIN'") was about auto-provisioning/sign-in specifically — the _authenticated, permission-gated_ administrative surface added here is a different trust boundary, the same one `positions:manage`/`employees:manage` already occupy for their own domains.
2. **Every mutation is independently server-authorized** via `requirePermission("users:manage")` (never a raw role comparison, never trusting client-supplied role/companyId — same pattern as every other Phase 4+ mutation, ADR-0012).
3. **Last-admin protection is enforced transactionally**, not just as a pre-check (§ concurrency, below) — the one guarantee that, if missed, could make a CLI-only model look safer than it actually was (a determined single `ADMIN` using the CLI could already lock out a company by disabling themselves with zero warning; the CLI has no such guard today, and this ADR does not add one there — see Known Limitations).
4. **Every provisioning/role/disable/link action is audited** (ADR-0008/Phase 12's audit writer), giving strictly _more_ accountability than the CLI's un-audited direct database writes.

## Rationale

- The original concern ADR-0011 closed was privilege escalation _without_ an existing privileged session — that gap remains fully closed.
- Requiring deploy/CLI access for every routine role change does not scale as an operational model once a company has more than a handful of users, and the task brief treats this as a genuine product requirement for this phase, not an incidental nice-to-have.
- Keeping the CLI is still valuable as a break-glass path (e.g. bootstrapping the very first `ADMIN` for a new company, per `create-admin`) and is unchanged.

## Alternatives Considered

- **Keep CLI-only, decline to build the web UI:** rejected — directly contradicts this phase's explicit, current-brief requirement; CLAUDE.md §1.2's "raise it, don't silently override it" is satisfied by this ADR, not by refusing the brief.
- **Add a fourth role (e.g. `USER_ADMIN`) distinct from `ADMIN` for user administration:** rejected — no such role was specified anywhere, and inventing one is exactly the kind of unrequested scope CLAUDE.md §1.4 warns against; `users:manage`/`settings:manage` already exist as ADMIN-only permissions and are sufficient.

## Consequences

- `scripts/provision-user.ts` remains the CLI break-glass path and is **not** given last-admin protection in this phase — that gap is pre-existing (ADR-0011 never had it either) and is out of this phase's scope to fix; documented as a Known Limitation in the Phase 12 report.
- `docs/AUTHORIZATION_MATRIX.md` §5/§7 is updated to describe both paths (CLI and web) side by side, not replace the CLI's row.
- Any future phase adding a third administrative surface (e.g. a public API) must independently re-derive this same safety argument — it does not follow automatically just because the web UI exists.
