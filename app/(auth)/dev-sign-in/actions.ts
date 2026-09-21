"use server";

import type { UserRole } from "@prisma/client";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { createDevSession, isDevSignInEnabled } from "@/lib/auth/dev-sign-in";
import { sessionCookieFor } from "@/lib/auth/session-cookie";

export async function devSignInAsRoleAction(role: UserRole): Promise<void> {
  if (!isDevSignInEnabled()) {
    throw new Error("Dev sign-in is disabled outside local development.");
  }

  const { sessionToken, maxAgeSeconds } = await createDevSession(role);

  const cookie = sessionCookieFor((await headers()).get("x-forwarded-proto"));
  (await cookies()).set(cookie.name, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
    secure: cookie.secure,
  });

  redirect("/dashboard");
}
