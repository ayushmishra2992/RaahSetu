import { env } from "./config/env";
import { prisma } from "./config/prisma";
import { createApp } from "./app";

const app = createApp();

/** Database name and host only — never credentials — so it is obvious which database is in use. */
function describeDatabase(url: string): string {
  try {
    const u = new URL(url);
    return `${decodeURIComponent(u.pathname.replace(/^\//, "")) || "(default)"} @ ${u.host}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

const server = app.listen(env.PORT, () => {
  console.log(`RaahSetu API running on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  console.log(`Database: ${describeDatabase(env.DATABASE_URL)}`);
});

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
