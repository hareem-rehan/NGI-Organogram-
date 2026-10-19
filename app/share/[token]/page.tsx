import type { Metadata } from "next";
import Image from "next/image";
import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/patterns/loading-state";
import { OrganogramView } from "@/app/(app)/organogram/_components/organogram-view";
import { prisma } from "@/lib/db/prisma";
import { publicEnv } from "@/lib/env.public";
import { resolveShareLink, ShareLinkUnavailableError } from "@/lib/services/share-link.service";
import { shareTokenSchema } from "@/lib/validation/share-link";

/**
 * A view-only organogram link (docs/DECISIONS.md D60). Lives outside the
 * signed-in (app) area on purpose: no sign-in, no menu, no other pages.
 * The token is checked here for a clear message up front, and again by
 * every server action the page calls.
 */

export const metadata: Metadata = {
  title: "Organization chart",
  // A share link must never end up in a search index.
  robots: { index: false, follow: false },
};

// Always checked per request (a link can be turned off at any moment).
export const dynamic = "force-dynamic";

async function companyNameFor(token: string): Promise<string | null> {
  if (!shareTokenSchema.safeParse(token).success) return null;
  try {
    const link = await resolveShareLink(token);
    const company = await prisma.company.findUnique({
      where: { id: link.companyId },
      select: { name: true },
    });
    return company?.name ?? null;
  } catch (error) {
    if (error instanceof ShareLinkUnavailableError) return null;
    throw error;
  }
}

export default async function SharedOrganogramPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const companyName = await companyNameFor(token);

  return (
    <div className="bg-background min-h-screen">
      <header className="border-border flex h-14 items-center gap-3 border-b px-4">
        <Image
          src="/brand/dotzero-wordmark.svg"
          alt={publicEnv.NEXT_PUBLIC_APP_NAME}
          height={24}
          width={110}
          priority
        />
        {companyName ? (
          <span className="text-muted-foreground truncate text-sm">{companyName}</span>
        ) : null}
        <Badge variant="outline" className="ml-auto">
          View only
        </Badge>
      </header>
      <main className="mx-auto flex max-w-[1600px] flex-col gap-4 p-4 sm:p-6">
        {companyName ? (
          <>
            <h1 className="text-foreground text-xl font-semibold">Organization chart</h1>
            <Suspense fallback={<LoadingState label="Loading organization chart…" />}>
              <OrganogramView
                canManage={false}
                canViewEmployeeDetails={false}
                canExport
                shareToken={token}
              />
            </Suspense>
          </>
        ) : (
          <section
            role="status"
            className="border-border bg-muted mx-auto mt-16 flex max-w-md flex-col gap-2 rounded-lg border p-6 text-center"
          >
            <h1 className="text-foreground text-lg font-semibold">
              This link isn&apos;t available
            </h1>
            <p className="text-muted-foreground text-sm">
              It has expired or been turned off. Ask the person who shared it for a new one.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
