import type { Metadata } from "next";

import { publicEnv } from "@/lib/env.public";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: publicEnv.NEXT_PUBLIC_APP_NAME,
    template: `%s · ${publicEnv.NEXT_PUBLIC_APP_NAME}`,
  },
  description:
    "Internal HR tool for managing departments, positions, employees, and the company organogram.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
