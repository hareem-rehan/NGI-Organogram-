"use server";

import { signIn, signOut } from "@/lib/auth/config";

const OIDC_PROVIDER_ID = "company-sso";

export async function signInWithCompanySso(): Promise<void> {
  await signIn(OIDC_PROVIDER_ID);
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/sign-in" });
}
