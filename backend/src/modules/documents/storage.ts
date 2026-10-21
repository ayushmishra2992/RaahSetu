import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../../config/env";
import { badRequest } from "../../lib/errors";

/** Allowed upload types, verified by both declared MIME type and file signature. */
const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  "application/pdf": (b) => b.subarray(0, 5).toString("latin1") === "%PDF-",
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/webp": (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
};

export const ALLOWED_MIME_TYPES = Object.keys(SIGNATURES);

export function assertAllowedFile(mimeType: string, buffer: Buffer) {
  const check = SIGNATURES[mimeType];
  if (!check) throw badRequest(`File type ${mimeType} is not allowed. Use PDF, PNG, JPEG or WEBP.`);
  if (!check(buffer)) throw badRequest("File content does not match its declared type");
}

function root() {
  return path.resolve(env.UPLOAD_DIR);
}

function fullPath(companyId: number, key: string) {
  if (!/^[a-f0-9]{32}$/.test(key)) throw badRequest("Invalid storage key");
  return path.join(root(), String(companyId), key);
}

export async function saveFile(companyId: number, key: string, data: Buffer) {
  const p = fullPath(companyId, key);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, data);
}

export async function readStoredFile(companyId: number, key: string) {
  return readFile(fullPath(companyId, key));
}

export async function deleteStoredFile(companyId: number, key: string) {
  await unlink(fullPath(companyId, key)).catch(() => undefined);
}
