import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Access Denied" };

export default function AccessDeniedPage() {
  return (
    <div className="w-full max-w-sm text-center">
      <p className="text-destructive text-sm font-medium">Access denied</p>
      <h1 className="text-foreground mt-2 text-2xl font-semibold tracking-tight">
        You don&apos;t have permission to view this page
      </h1>
      <p className="text-muted-foreground mt-2 text-sm">
        If you believe you should have access, contact your administrator.
      </p>
      <Button asChild className="mt-6">
        <Link href="/dashboard">Go to Dashboard</Link>
      </Button>
    </div>
  );
}
