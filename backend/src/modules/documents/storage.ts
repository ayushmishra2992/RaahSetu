// Kept for existing imports: document storage now lives in src/lib/storage.ts
// (local disk or S3-compatible private bucket, chosen by STORAGE_DRIVER).
import { storage } from "../../lib/storage";

export { ALLOWED_MIME_TYPES, assertAllowedFile } from "../../lib/storage";

export function saveFile(companyId: number, key: string, data: Buffer, mimeType = "application/octet-stream") {
  return storage.put(companyId, key, data, mimeType);
}

export function readStoredFile(companyId: number, key: string) {
  return storage.get(companyId, key);
}

export function deleteStoredFile(companyId: number, key: string) {
  return storage.delete(companyId, key);
}
