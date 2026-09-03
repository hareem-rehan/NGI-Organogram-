import type { Metadata } from "next";
import { redirect } from "next/navigation";

import Image from "next/image";
import Link from "next/link";

import { publicEnv } from "@/lib/env.public";
import { serverEnv } from "@/lib/env.server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { signInWithCompanySso } from "@/lib/auth/actions";
import { safeSignInErrorMessage } from "@/lib/auth/error-messages";
import { isDevSignInEnabled } from "@/lib/auth/dev-sign-in";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Sign in" };

interface SignInPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const user = await getCurrentUser();
  if (user) {
    redirect("/dashboard");
  }

  const { error } = await searchParams;
  const errorMessage = safeSignInErrorMessage(error);

  return (
    <div className="w-full max-w-sm text-center">
      <Image
        src="/brand/dotzero-wordmark-red.svg"
        alt={publicEnv.NEXT_PUBLIC_APP_NAME}
        height={40}
        width={185}
        priority
        className="mx-auto"
      />
      <p className="text-muted-foreground mt-2 text-sm">Sign in to continue.</p>

      {errorMessage ? (
        <p
          role="alert"
          className="border-destructive/30 bg-destructive/5 text-destructive mt-6 rounded-md border px-4 py-3 text-sm"
        >
          {errorMessage}
        </p>
      ) : null}

      <form action={signInWithCompanySso} className="mt-8">
        <Button type="submit" className="w-full">
          Sign in with {serverEnv.AUTH_PROVIDER_NAME}
        </Button>
      </form>

      {isDevSignInEnabled() ? (
        <p className="text-muted-foreground mt-6 text-xs">
          Local development —{" "}
          <Link href="/dev-sign-in" className="underline underline-offset-2">
            skip SSO and sign in as a test role
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}
