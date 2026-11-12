import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "@/components/Providers";
import "./globals.css";

// Self-hosted at build time by next/font: browsers make no requests to Google.
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

export const metadata: Metadata = {
  title: { default: "RaahSetu 2.0", template: "%s · RaahSetu" },
  description: "Fleet operations, constrained route optimization, GreenFleet estimates and dispatch control tower.",
};

export const viewport: Viewport = {
  themeColor: "#0a1520",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
