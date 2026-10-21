import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "RaahSetu 2.0", template: "%s · RaahSetu" },
  description: "Fleet operations, constrained route optimization, GreenFleet estimates and dispatch control tower.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
