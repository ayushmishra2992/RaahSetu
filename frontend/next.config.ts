import type { NextConfig } from "next";

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

export default nextConfig;
