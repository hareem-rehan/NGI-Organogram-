import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { UserRole } from "@prisma/client";

import { isDevSignInEnabled } from "@/lib/auth/dev-sign-in";
import { getCurrentUser } from "@/lib/auth/current-user";
import { Button } from "@/components/ui/button";
import { devSignInAsRoleAction } from "./actions";

export const metadata: Metadata = { title: "Dev sign-in" };

/**
 * Evaluate the gate per request, not at build time.
 *
 * Without this Next prerenders the route statically, which bakes in
 * whatever `isDevSignInEnabled()` returned during the build. On a
 * deployed build that means a permanent 404 no matter what
 * AUTH_ALLOW_DEV_SIGN_IN is set to afterwards — the flag would appear to
 * do nothing. (Caught by actually running a production build with the
 * flag set, rather than assuming the runtime read was enough.)
 *
 * This makes the page respect the flag; it does not make it reachable.
 * The gate below still runs on every request, as do the two independent
 * checks behind it.
 */
export const dynamic = "force-dynamic";

const ROLES: readonly UserRole[] = ["ADMIN", "HR_EDITOR", "VIEWER"];

/**
 * Never reachable unless deliberately enabled — always in local
 * development, and on a deployed build only with AUTH_ALLOW_DEV_SIGN_IN.
 * `notFound()` here is defense in depth: `devSignInAsRoleAction` and
 * `createDevSession` each independently re-check `isDevSignInEnabled()`
 * too, so this page rendering is never the only thing standing between a
 * real deployment and this feature.
 */
export default async function DevSignInPage() {
  if (!isDevSignInEnabled()) {
    notFound();
  }

  const user = await getCurrentUser();
  if (user) {
    redirect("/dashboard");
  }

  return (
    <div className="w-full max-w-sm text-center">
      <h1 className="text-foreground text-2xl font-semibold tracking-tight">Dev sign-in</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Local development only — never available in production. Picks one fixed, stable local-dev
        company and signs you in as that role instantly, no real identity provider required.
      </p>

      <div className="mt-8 flex flex-col gap-3">
        {ROLES.map((role) => (
          <form key={role} action={devSignInAsRoleAction.bind(null, role)}>
            <Button type="submit" variant="outline" className="w-full">
              Sign in as {role}
            </Button>
          </form>
        ))}
      </div>
    </div>
  );
}
