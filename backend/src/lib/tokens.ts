import { randomBytes } from "node:crypto";

/** URL-safe, unguessable token used for public QR verification links. */
export function verificationToken(): string {
  return randomBytes(18).toString("base64url");
}

export function storageKey(): string {
  return randomBytes(16).toString("hex");
}
