"use server";

import type { UserRole } from "@prisma/client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createDevSession, isDevSignInEnabled } from "@/lib/auth/dev-sign-in";

/** Same cookie name Auth.js's own database-session strategy uses in non-HTTPS/local development (no custom `cookies` config exists in lib/auth/config.ts, so this is its unmodified default). */
const SESSION_COOKIE_NAME = "authjs.session-token";

export async function devSignInAsRoleAction(role: UserRole): Promise<void> {
  if (!isDevSignInEnabled()) {
    throw new Error("Dev sign-in is disabled outside local development.");
  }

  const { sessionToken, maxAgeSeconds } = await createDevSession(role);

  (await cookies()).set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
    secure: false,
  });

  redirect("/dashboard");
}
