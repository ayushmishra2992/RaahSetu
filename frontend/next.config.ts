import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

/**
 * The browser talks only to this Next.js server; `/api/*` is proxied to the
 * Express backend so the httpOnly session cookie is first-party.
 */
const backendUrl = (process.env.BACKEND_URL ?? "http://localhost:5000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Docker image uses the self-contained server; normal builds are unchanged.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  reactStrictMode: true,
  // Dev-only indicator: keep it clear of the sidebar's collapse control (bottom-left).
  devIndicators: { position: "bottom-right" },
  turbopack: { root: process.cwd() },
  outputFileTracingRoot: process.cwd(),
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backendUrl}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

/**
 * `*.dev.tsx` pages (e.g. the /design-system component catalogue) exist only
 * under `next dev`; production builds don't route or bundle them.
 */
export default function config(phase: string): NextConfig {
  const base = ["tsx", "ts", "jsx", "js"];
  return { ...nextConfig, pageExtensions: phase === PHASE_DEVELOPMENT_SERVER ? ["dev.tsx", ...base] : base };
}
