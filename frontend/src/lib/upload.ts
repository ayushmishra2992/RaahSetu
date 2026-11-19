import { ApiError } from "./api";

/** What the backend accepts (it re-checks MIME type, extension and file signature). */
export const DOC_MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export const PHOTO_MIME = ["image/jpeg", "image/png"] as const;
export const MAX_UPLOAD_MB = 5;

/** Returns a human-readable problem with a picked file, or null when it is acceptable. */
export function fileProblem(file: { name: string; type: string; size: number }, allowed: readonly string[] = DOC_MIME, maxMb = MAX_UPLOAD_MB): string | null {
  if (!file.size) return `${file.name || "The file"} is empty.`;
  const isHeic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
  if (isHeic) return "HEIC photos are not supported. In the camera settings choose “Most compatible”, or take the photo with the in-app camera button.";
  if (!allowed.includes(file.type)) {
    const names = allowed.map((m) => m.split("/")[1].toUpperCase().replace("JPEG", "JPG")).join(", ");
    return `${file.name || "This file"} is ${file.type || "an unknown type"}. Use ${names}.`;
  }
  // Images are compressed before upload, so only PDFs are held to the size limit here.
  if (file.type === "application/pdf" && file.size > maxMb * 1024 * 1024) return `${file.name} is ${(file.size / 1048576).toFixed(1)} MB; the limit is ${maxMb} MB.`;
  return null;
}

/** Scale (w, h) down to fit within max×max, keeping the aspect ratio; never scales up. */
export function fitWithin(w: number, h: number, max: number): { width: number; height: number } {
  if (w <= 0 || h <= 0) return { width: 0, height: 0 };
  const k = Math.min(1, max / Math.max(w, h));
  return { width: Math.round(w * k), height: Math.round(h * k) };
}

/** Canvas size after rotating by a multiple of 90°. */
export function rotatedSize(w: number, h: number, quarterTurns: number) {
  return quarterTurns % 2 === 0 ? { width: w, height: h } : { width: h, height: w };
}

export function jpegName(name: string) {
  const base = (name || "photo").replace(/\.[^.]+$/, "");
  return `${base}.jpg`;
}

/**
 * Resize, rotate and re-encode a photo as JPEG in the browser. Phone photos are
 * often 4–12 MB; documents stay legible at ~1600 px, which keeps uploads well
 * under the limit even on slow mobile data. EXIF orientation is applied by the
 * browser when decoding, and EXIF metadata (including GPS) is dropped.
 */
export async function compressImage(file: File, opts: { maxDim?: number; quality?: number; quarterTurns?: number } = {}): Promise<File> {
  const maxDim = opts.maxDim ?? 1600;
  const quality = opts.quality ?? 0.82;
  const turns = ((opts.quarterTurns ?? 0) % 4 + 4) % 4;
  const image = await decodeImage(file);
  try {
    const fit = fitWithin(image.width, image.height, maxDim);
    const out = rotatedSize(fit.width, fit.height, turns);
    const canvas = document.createElement("canvas");
    canvas.width = out.width;
    canvas.height = out.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot process images");
    ctx.fillStyle = "#ffffff"; // PNG transparency → white paper, not black
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate((turns * Math.PI) / 2);
    ctx.drawImage(image.source, -fit.width / 2, -fit.height / 2, fit.width, fit.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
    if (!blob) throw new Error("Could not compress the image");
    return new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: Date.now() });
  } finally {
    image.close();
  }
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

/**
 * Decode an image with EXIF orientation applied, trying progressively more
 * widely supported browser APIs:
 *   1. createImageBitmap(file, { imageOrientation: "from-image" })
 *   2. createImageBitmap(file) — some browsers reject the options object; modern
 *      engines still apply EXIF orientation by default
 *   3. an <img> element — universally supported; browsers apply EXIF orientation
 *      to images by default (CSS image-orientation: from-image)
 * Exported for tests; not verified on a physical iPhone.
 */
export async function decodeImage(file: Blob, api: { createImageBitmap?: typeof createImageBitmap; loadImage?: (url: string) => Promise<HTMLImageElement> } = {}): Promise<DecodedImage> {
  const cib = api.createImageBitmap ?? (typeof createImageBitmap === "function" ? createImageBitmap : undefined);
  const fromBitmap = (b: ImageBitmap): DecodedImage => ({ source: b, width: b.width, height: b.height, close: () => b.close() });
  if (cib) {
    try {
      return fromBitmap(await cib(file, { imageOrientation: "from-image" }));
    } catch {
      try {
        return fromBitmap(await cib(file));
      } catch {
        /* fall through to <img> */
      }
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await (api.loadImage ?? loadImageElement)(url);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) throw new Error("empty image");
    return { source: img, width, height, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("This photo could not be read by your browser. Try another photo, or upload it as a PDF.");
  }
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode failed"));
    img.src = url;
  });
}

/**
 * Multipart upload with progress (fetch cannot report upload progress).
 * Same error shape as `api()`, so callers can use errorMessage().
 */
export function uploadWithProgress<T>(path: string, form: FormData, onProgress?: (fraction: number) => void, method = "POST"): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `/api${path}`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new ApiError(0, "Upload failed — check your connection and try again."));
    xhr.ontimeout = () => reject(new ApiError(0, "Upload timed out — check your connection and try again."));
    xhr.timeout = 120_000;
    xhr.onload = () => {
      let data: unknown;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
      } catch {
        data = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve(data as T);
        return;
      }
      const err = (data as { error?: { message?: string; details?: unknown } } | undefined)?.error;
      const fallback = xhr.status === 413 ? `The file is too large (limit ${MAX_UPLOAD_MB} MB).` : xhr.status >= 500 ? "Server error — please try again." : `Upload failed (${xhr.status})`;
      reject(new ApiError(xhr.status, err?.message ?? fallback, err?.details));
    };
    xhr.send(form);
  });
}

/** Fetches a short-lived signed link for an attachment and opens it. */
export async function openAttachment(id: number) {
  const res = await fetch(`/api/attachments/${id}/url`, { credentials: "same-origin" });
  if (!res.ok) throw new ApiError(res.status, res.status === 404 ? "File not found or no access" : "Could not get a download link");
  const { url } = (await res.json()) as { url: string };
  window.open(url, "_blank", "noopener");
}
