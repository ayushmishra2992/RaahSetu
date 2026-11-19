import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HEALTHCHECK_COMPANY_ID, LocalStorage, readIfExists, S3Storage, StorageNotFoundError, StorageUnavailableError, storageStatus } from "../../src/lib/storage";

/**
 * A minimal in-process S3 stand-in (path-style). It does not verify signatures —
 * it records what the real AWS SDK sends, so the driver's wiring (bucket/key
 * layout, headers, signing, presigned links, error mapping) is checked offline.
 * No real provider, account or customer document is involved.
 */
interface Recorded {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
}
function fakeS3(mode: "ok" | "denied" | "down") {
  const objects = new Map<string, { body: Buffer; type: string }>();
  const requests: Recorded[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    requests.push({ method: req.method!, url: req.url!, headers: req.headers });
    const key = decodeURIComponent(new URL(req.url!, "http://x").pathname);
    if (mode === "down") {
      res.writeHead(500, { "content-type": "application/xml" }).end("<Error><Code>InternalError</Code><Message>boom</Message></Error>");
      return;
    }
    if (mode === "denied") {
      res.writeHead(403, { "content-type": "application/xml" }).end("<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>");
      return;
    }
    if (req.method === "PUT") {
      objects.set(key, { body: Buffer.concat(chunks), type: String(req.headers["content-type"]) });
      res.writeHead(200, { etag: '"x"' }).end();
    } else if (req.method === "GET") {
      const o = objects.get(key);
      if (!o) {
        res.writeHead(404, { "content-type": "application/xml" }).end("<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>");
        return;
      }
      const q = new URL(req.url!, "http://x").searchParams;
      res.writeHead(200, { "content-type": q.get("response-content-type") ?? o.type, "content-disposition": q.get("response-content-disposition") ?? "", "content-length": o.body.length }).end(o.body);
    } else if (req.method === "DELETE") {
      objects.delete(key);
      res.writeHead(204).end();
    } else res.writeHead(405).end();
  });
  return { server, objects, requests };
}

async function listen(server: Server) {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const SECRET = "test-secret-key-not-real-0123456789";
const KEY = "0123456789abcdef0123456789abcdef";
const driverFor = (endpoint: string) => new S3Storage("raahsetu-docs", { region: "us-east-1", endpoint, accessKeyId: "TESTACCESSKEY", secretAccessKey: SECRET, forcePathStyle: true });

describe("S3-compatible storage driver (offline, fake S3)", () => {
  const ok = fakeS3("ok");
  const denied = fakeS3("denied");
  const down = fakeS3("down");
  let s3: S3Storage;
  let s3Denied: S3Storage;
  let s3Down: S3Storage;

  beforeAll(async () => {
    s3 = driverFor(await listen(ok.server));
    s3Denied = driverFor(await listen(denied.server));
    s3Down = driverFor(await listen(down.server));
  });
  afterAll(async () => {
    for (const f of [ok, denied, down]) await new Promise((r) => f.server.close(r));
  });

  it("uploads under the tenant prefix with type and length, signed with SigV4", async () => {
    const body = Buffer.from("%PDF-1.4 insurance");
    await s3.put(7, KEY, body, "application/pdf");
    const stored = ok.objects.get(`/raahsetu-docs/company-7/${KEY}`);
    expect(stored?.body.equals(body)).toBe(true);
    expect(stored?.type).toBe("application/pdf");
    const put = ok.requests.find((r) => r.method === "PUT")!;
    expect(String(put.headers.authorization)).toMatch(/^AWS4-HMAC-SHA256 Credential=TESTACCESSKEY\//);
    expect(JSON.stringify(put.headers)).not.toContain(SECRET);
    expect(put.headers["content-length"]).toBe(String(body.length));
    // No aws-chunked trailers (rejected by several S3-compatible providers).
    expect(String(put.headers["content-encoding"] ?? "")).not.toMatch(/aws-chunked/);
    expect(put.headers["x-amz-trailer"]).toBeUndefined();
  });

  it("downloads the same bytes and keeps tenants apart", async () => {
    expect((await s3.get(7, KEY)).toString()).toBe("%PDF-1.4 insurance");
    await expect(s3.get(8, KEY)).rejects.toBeInstanceOf(StorageNotFoundError); // other company, same key
    expect(await readIfExists(8, KEY, s3)).toBeNull();
  });

  it("issues presigned links that expire, force a download and work without other credentials", async () => {
    const url = await s3.presignedGetUrl(7, KEY, "insurance policy.pdf", "application/pdf", 300);
    expect(url).toBeTruthy();
    const u = new URL(url!);
    expect(u.pathname).toBe(`/raahsetu-docs/company-7/${KEY}`);
    expect(u.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(u.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(u.searchParams.get("response-content-disposition")).toMatch(/^attachment; filename="insurance policy\.pdf"/);
    expect(url).not.toContain(SECRET);
    const res = await fetch(url!);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("%PDF-1.4 insurance");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment/);
  });

  it("deletes objects and treats deleting a missing object as done", async () => {
    await s3.delete(7, KEY);
    expect(await readIfExists(7, KEY, s3)).toBeNull();
    await expect(s3.delete(7, KEY)).resolves.toBeUndefined();
  });

  it("maps access-denied and outages to 503 STORAGE_UNAVAILABLE, never to 'not found'", async () => {
    for (const d of [s3Denied, s3Down]) {
      const up = await d.put(7, KEY, Buffer.from("x"), "application/pdf").catch((e) => e);
      expect(up).toBeInstanceOf(StorageUnavailableError);
      expect(up.status).toBe(503);
      expect(up.code).toBe("STORAGE_UNAVAILABLE");
      expect(up.message).toMatch(/nothing was saved/);
      expect(up.message).not.toMatch(/Access Denied|boom|TESTACCESSKEY/); // provider details stay in logs
      const down2 = await d.get(7, KEY).catch((e) => e);
      expect(down2).toBeInstanceOf(StorageUnavailableError);
      await expect(readIfExists(7, KEY, d)).rejects.toBeInstanceOf(StorageUnavailableError);
    }
  }, 30_000);

  it("keeps the operator self-test under its own prefix", async () => {
    await s3.put(HEALTHCHECK_COMPANY_ID, KEY, Buffer.from("hc"), "application/octet-stream");
    expect(ok.objects.has(`/raahsetu-docs/system-healthcheck/${KEY}`)).toBe(true);
    await s3.delete(HEALTHCHECK_COMPANY_ID, KEY);
  });

  it("rejects malformed keys and negative company ids before any request", async () => {
    const before = ok.requests.length;
    await expect(s3.put(7, "../../etc/passwd", Buffer.from("x"), "text/plain")).rejects.toThrow(/Invalid storage key/);
    await expect(s3.get(-1, KEY)).rejects.toThrow(/Invalid company/);
    expect(ok.requests.length).toBe(before);
  });

  it("reports S3 as persistent", () => {
    expect(storageStatus(s3)).toEqual({ driver: "s3", persistent: true, warning: null });
  });
});

describe("local storage driver", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "raahsetu-storage-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips, refuses to overwrite and distinguishes missing files", async () => {
    const local = new LocalStorage(dir, true);
    await local.put(3, KEY, Buffer.from("hello"), "text/plain");
    expect((await local.get(3, KEY)).toString()).toBe("hello");
    await expect(local.put(3, KEY, Buffer.from("again"), "text/plain")).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(local.get(4, KEY)).rejects.toBeInstanceOf(StorageNotFoundError);
    expect(await readIfExists(4, KEY, local)).toBeNull();
    expect(await local.presignedGetUrl()).toBeNull(); // local uses HMAC /api/files links instead
  });

  it("is reported as NOT persistent in production, with an explicit warning", () => {
    expect(storageStatus(new LocalStorage(dir, false))).toEqual({
      driver: "local",
      persistent: false,
      warning: expect.stringMatching(/wiped on redeploy\/restart.*STORAGE_DRIVER=s3/),
    });
    expect(storageStatus(new LocalStorage(dir, true)).warning).toBeNull();
  });
});
