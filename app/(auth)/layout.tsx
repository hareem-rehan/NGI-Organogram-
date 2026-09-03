import type { ReactNode } from "react";

export default function AuthRouteGroupLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      {children}
    </div>
  );
}
