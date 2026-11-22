/**
 * Operator self-test for document storage: `npm run storage:check`.
 *
 * Uses the configured STORAGE_DRIVER exactly as the API does. With "s3" it
 * CONTACTS THE CONFIGURED PROVIDER: it writes one 64-byte synthetic object under
 * the reserved `system-healthcheck/` prefix, reads it back, checks a presigned
 * link, then deletes it. No customer document is read or written, and no
 * credential is printed.
 */
import { randomBytes } from "node:crypto";
import { env } from "../config/env";
import { HEALTHCHECK_COMPANY_ID, readIfExists, storage, storageStatus } from "../lib/storage";
import { storageKey } from "../lib/tokens";

async function main() {
  const status = storageStatus();
  console.log(`driver=${status.driver} persistent=${status.persistent}${env.STORAGE_DRIVER === "s3" ? ` bucket=${env.S3_BUCKET} region=${env.S3_REGION} endpoint=${env.S3_ENDPOINT ?? "(AWS default)"}` : ` dir=${env.UPLOAD_DIR}`}`);
  if (status.warning) console.log(`warning: ${status.warning}`);

  const key = storageKey();
  const payload = randomBytes(64);
  const step = async <T>(name: string, fn: () => Promise<T>) => {
    const t0 = Date.now();
    try {
      const r = await fn();
      console.log(`ok   ${name} (${Date.now() - t0} ms)`);
      return r;
    } catch (e) {
      console.log(`FAIL ${name}: ${(e as Error).message}`);
      throw e;
    }
  };

  try {
    await step("upload", () => storage.put(HEALTHCHECK_COMPANY_ID, key, payload, "application/octet-stream"));
    const back = await step("download", () => storage.get(HEALTHCHECK_COMPANY_ID, key));
    if (!back.equals(payload)) throw new Error("downloaded bytes differ from uploaded bytes");
    console.log("ok   content matches");
    const url = await step("presign", () => storage.presignedGetUrl(HEALTHCHECK_COMPANY_ID, key, "healthcheck.bin", "application/octet-stream", 60));
    if (url) {
      const res = await step("fetch presigned link", () => fetch(url));
      const body = Buffer.from(await res.arrayBuffer());
      if (!res.ok || !body.equals(payload)) throw new Error(`presigned link returned HTTP ${res.status}`);
      const disp = res.headers.get("content-disposition") ?? "";
      console.log(`ok   presigned link works; content-disposition=${disp.includes("attachment") ? "attachment" : disp || "(none)"}`);
      const anon = await fetch(url.split("?")[0]);
      console.log(anon.ok ? "WARN the object is readable WITHOUT a signature — the bucket is public; make it private" : `ok   unsigned access refused (HTTP ${anon.status}) — bucket is private`);
    } else {
      console.log("ok   local driver: downloads use HMAC-signed /api/files links (no provider link)");
    }
  } finally {
    await storage.delete(HEALTHCHECK_COMPANY_ID, key);
    const gone = await readIfExists(HEALTHCHECK_COMPANY_ID, key).catch(() => "error");
    console.log(gone === null ? "ok   cleanup (object deleted)" : "WARN cleanup could not be confirmed");
  }
  console.log("STORAGE CHECK PASSED");
}

main().catch(() => {
  console.log("STORAGE CHECK FAILED");
  process.exit(1);
});
