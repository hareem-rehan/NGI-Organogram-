import "server-only";
import type { User } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

export interface ResolveSignInInput {
  provider: string;
  /** The identity provider's stable subject claim — never the email — used to look up/create the Account link. */
  providerAccountId: string;
  /** Already validated and normalized (lib/auth/identity-validation.ts ran first). */
  email: string;
  displayName: string | null;
  imageUrl: string | null;
  autoProvisionViewers: boolean;
}

export type SignInResolution =
  | { outcome: "allow"; user: User; isNewUser: boolean }
  | { outcome: "deny"; reason: "disabled" }
  | { outcome: "deny"; reason: "unprovisioned" };

/**
 * The core provisioning decision (docs/AUTHORIZATION_MATRIX.md
 * "Provisioning Rules"):
 *
 * 1. An Account already linked to this provider+subject → use that
 *    User's existing role (ADMIN/HR_EDITOR/VIEWER — whatever an admin
 *    already set it to). Denied if that User is disabled.
 * 2. No linked Account yet, but a User row with this email already
 *    exists (pre-provisioned by `scripts/provision-user.ts`) → allow,
 *    using that user's existing role. Auth.js's adapter creates the
 *    Account link on this same sign-in (see docs/adr/0010-*.md for why
 *    `allowDangerousEmailAccountLinking` is enabled and why that's safe
 *    here specifically).
 * 3. Unknown email entirely → VIEWER auto-provisioning ONLY if
 *    explicitly enabled (`AUTH_AUTO_PROVISION_VIEWERS=true`) — an
 *    unknown user NEVER receives ADMIN or HR_EDITOR automatically,
 *    regardless of this flag.
 *
 * Company resolution: this MVP operates as a single company (Phase 2
 * built explicit companyId scoping into every table but no multi-tenant
 * *access control* yet — docs/DOMAIN_MODEL.md §11). Auto-provisioned
 * viewers are attached to the one existing company. If more than one
 * company exists (not expected in this phase), auto-provisioning is
 * refused rather than guessing which company — see the test for this.
 */
export async function resolveOrProvisionUserForSignIn(
  input: ResolveSignInInput
): Promise<SignInResolution> {
  const existingAccount = await prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: input.provider,
        providerAccountId: input.providerAccountId,
      },
    },
    include: { user: true },
  });

  if (existingAccount) {
    if (existingAccount.user.status !== "ACTIVE") {
      return { outcome: "deny", reason: "disabled" };
    }
    await touchLastLogin(existingAccount.user.id);
    return { outcome: "allow", user: existingAccount.user, isNewUser: false };
  }

  const existingUserByEmail = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingUserByEmail) {
    if (existingUserByEmail.status !== "ACTIVE") {
      return { outcome: "deny", reason: "disabled" };
    }
    await touchLastLogin(existingUserByEmail.id);
    return { outcome: "allow", user: existingUserByEmail, isNewUser: false };
  }

  if (!input.autoProvisionViewers) {
    return { outcome: "deny", reason: "unprovisioned" };
  }

  const companies = await prisma.company.findMany({ take: 2 });
  const [onlyCompany] = companies;
  if (companies.length !== 1 || !onlyCompany) {
    // Zero companies (nothing seeded yet) or more than one (ambiguous,
    // multi-tenant access control doesn't exist yet) — refuse rather
    // than guess.
    return { outcome: "deny", reason: "unprovisioned" };
  }

  const newUser = await prisma.user.create({
    data: {
      email: input.email,
      name: input.displayName,
      image: input.imageUrl,
      companyId: onlyCompany.id,
      role: "VIEWER",
      status: "ACTIVE",
      lastLoginAt: new Date(),
    },
  });

  return { outcome: "allow", user: newUser, isNewUser: true };
}

async function touchLastLogin(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
}
