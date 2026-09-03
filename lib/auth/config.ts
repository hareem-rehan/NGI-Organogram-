import "server-only";
import NextAuth, { type NextAuthConfig } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";

import { prisma } from "@/lib/db/prisma";
import { serverEnv } from "@/lib/env.server";
import { logger } from "@/lib/logger";
import {
  assertEmailDomainAllowed,
  assertTenantAllowed,
  extractIdentityClaims,
  IdentityValidationError,
  type RawIdentityProfile,
} from "@/lib/auth/identity-validation";
import { resolveOrProvisionUserForSignIn } from "@/lib/services/user.service";
import "@/lib/auth/types";

const OIDC_PROVIDER_ID = "company-sso";

/**
 * Provider-neutral OIDC configuration (docs/DECISIONS.md P8 resolution,
 * docs/adr/0010-authjs-provider-neutral-oidc.md). `type: "oidc"` with
 * only an `issuer` tells Auth.js to discover the token/authorization/
 * userinfo endpoints via `${issuer}/.well-known/openid-configuration` —
 * this is NOT Microsoft- or Google-specific code. See README.md
 * "Company SSO Setup" for how to point AUTH_OIDC_ISSUER at a specific
 * provider without changing any source file.
 */
const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(prisma),
  // Deliberately `undefined`, not `false`, when AUTH_TRUST_HOST isn't set:
  // Auth.js's own default (@auth/core/lib/utils/env.js) is
  // `config.trustHost ?? (auto-trust outside production)` — that `??`
  // only fires on `undefined`/`null`. Passing a literal `false` here
  // (e.g. from a Zod boolean transform's default) would silently defeat
  // that fallback and break sign-in on plain `localhost` in ordinary
  // `npm run dev`, not just non-standard hosts — discovered during
  // Phase 4 manual verification (docs/phase-reports/PHASE_04_DEPARTMENT_MANAGEMENT.md).
  trustHost: serverEnv.AUTH_TRUST_HOST || undefined,
  secret: serverEnv.AUTH_SECRET,
  session: {
    // Database-backed sessions (not JWT): disabling a user or changing
    // their role takes effect on their very next request, because the
    // session callback below re-reads the User row from the database on
    // every check — a JWT-only strategy would keep serving the stale
    // role/status until the token's own expiry. See
    // docs/phase-reports/PHASE_03_AUTHENTICATION_AND_RBAC.md "Session
    // Security" for the exact propagation guarantee this gives.
    strategy: "database",
    maxAge: 12 * 60 * 60, // 12 hours
  },
  pages: {
    signIn: "/sign-in",
    error: "/sign-in", // Auth.js appends ?error=... — the sign-in page renders a safe, generic message for any code.
  },
  providers: [
    {
      id: OIDC_PROVIDER_ID,
      name: serverEnv.AUTH_PROVIDER_NAME,
      type: "oidc",
      issuer: serverEnv.AUTH_OIDC_ISSUER,
      clientId: serverEnv.AUTH_OIDC_CLIENT_ID,
      clientSecret: serverEnv.AUTH_OIDC_CLIENT_SECRET,
      // See lib/services/user.service.ts's doc comment for exactly why
      // this is safe in this specific setup: sign-in is already gated by
      // an email-domain allowlist (and optional tenant check) before any
      // account linking happens, so the scenario this flag protects
      // against (an attacker registering a matching email at an
      // unrelated IdP) requires controlling an account within the
      // company's own configured tenant — outside this app's threat
      // model to prevent, same as any Company SSO deployment.
      allowDangerousEmailAccountLinking: true,
    },
  ],
  callbacks: {
    /**
     * Runs before any Account/User row is created or updated for this
     * sign-in attempt — this is where every rejection in
     * docs/NEGATIVE_SCENARIOS.md's identity-validation section actually
     * happens. Returning `false` (or throwing) blocks the sign-in
     * entirely; nothing is persisted.
     */
    async signIn({ profile, account }) {
      if (!account || account.provider !== OIDC_PROVIDER_ID) return false;

      try {
        const claims = (profile ?? {}) as RawIdentityProfile;
        const identity = extractIdentityClaims(claims);
        assertEmailDomainAllowed(identity.email, serverEnv.AUTH_ALLOWED_EMAIL_DOMAINS);
        assertTenantAllowed(
          claims,
          serverEnv.AUTH_OIDC_TENANT_CLAIM,
          serverEnv.AUTH_ALLOWED_TENANT_ID
        );

        const resolution = await resolveOrProvisionUserForSignIn({
          provider: OIDC_PROVIDER_ID,
          providerAccountId: identity.subject,
          email: identity.email,
          displayName: typeof claims.name === "string" ? claims.name : null,
          imageUrl: typeof claims.picture === "string" ? claims.picture : null,
          autoProvisionViewers: serverEnv.AUTH_AUTO_PROVISION_VIEWERS,
        });

        if (resolution.outcome === "deny") {
          logger.warn("sign-in denied", { reason: resolution.reason });
          return false;
        }

        return true;
      } catch (error) {
        if (error instanceof IdentityValidationError) {
          logger.warn("sign-in rejected by identity validation", { reason: error.reason });
        } else {
          logger.error("unexpected error during sign-in validation", {
            message: error instanceof Error ? error.message : "unknown",
          });
        }
        return false;
      }
    },

    /**
     * With the database session strategy, this runs on every session
     * read — it re-fetches the current role/status from the database
     * (via `user`, which the adapter already loaded fresh for this
     * request) rather than trusting anything cached in a cookie/token.
     */
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        session.user.role = user.role;
        session.user.status = user.status;
        session.user.companyId = user.companyId;
      }
      return session;
    },
  },
  events: {
    async signIn({ user, isNewUser }) {
      logger.info("user signed in", { userId: user.id, isNewUser: Boolean(isNewUser) });
    },
    async signOut() {
      logger.info("user signed out");
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
