"use client";

import { Camera, FileText, ImagePlus, RotateCw, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { compressImage, DOC_MIME, fileProblem } from "@/lib/upload";
import { Button, Spinner } from "./ds";

export interface PickedFile {
  key: string;
  /** What will be uploaded (compressed/rotated JPEG for photos, original for PDFs). */
  file: File;
  original: File;
  turns: number;
  previewUrl: string | null;
}

let seq = 0;

/**
 * Mobile-first file picker: "Take photo" opens the rear camera directly
 * (capture="environment"), "Choose file" opens the gallery / file manager.
 * Photos are previewed, can be rotated, and are compressed before upload.
 */
export function FileCapture({
  label,
  value,
  onChange,
  max = 1,
  allowed = DOC_MIME,
  allowPdf = true,
  hint,
}: {
  label: string;
  value: PickedFile[];
  onChange: (files: PickedFile[]) => void;
  max?: number;
  allowed?: readonly string[];
  allowPdf?: boolean;
  hint?: string;
}) {
  const id = useId();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);

  // Release preview URLs when the component goes away.
  useEffect(() => () => latest.current.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl)), []);

  async function prepare(original: File, turns: number): Promise<PickedFile> {
    const isImage = original.type.startsWith("image/");
    const file = isImage ? await compressImage(original, { quarterTurns: turns }) : original;
    return { key: `f${++seq}`, file, original, turns, previewUrl: isImage ? URL.createObjectURL(file) : null };
  }

  async function add(list: FileList | null) {
    if (!list?.length) return;
    setProblem(null);
    const room = max - value.length;
    const picked = Array.from(list).slice(0, Math.max(0, room));
    if (list.length > room) setProblem(`Only ${max} file${max === 1 ? "" : "s"} allowed here.`);
    const accept = allowPdf ? allowed : allowed.filter((m) => m !== "application/pdf");
    for (const f of picked) {
      const p = fileProblem(f, accept);
      if (p) {
        setProblem(p);
        return;
      }
    }
    setBusy(true);
    try {
      const prepared = [];
      for (const f of picked) prepared.push(await prepare(f, 0));
      onChange(max === 1 ? prepared.slice(0, 1) : [...value, ...prepared]);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not read that file");
    } finally {
      setBusy(false);
    }
  }

  async function rotate(p: PickedFile) {
    setBusy(true);
    try {
      const next = await prepare(p.original, (p.turns + 1) % 4);
      if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      onChange(value.map((v) => (v.key === p.key ? next : v)));
    } finally {
      setBusy(false);
    }
  }

  function remove(p: PickedFile) {
    if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
    onChange(value.filter((v) => v.key !== p.key));
  }

  const full = value.length >= max;
  return (
    <div className="space-y-2" role="group" aria-labelledby={`${id}-label`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={`${id}-label`} className="text-sm font-medium text-ink">
          {label}
        </span>
        {busy && (
          <span className="flex items-center gap-1.5 text-xs text-muted" role="status">
            <Spinner size={14} /> Preparing…
          </span>
        )}
      </div>
      {!full && (
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" icon={Camera} onClick={() => cameraRef.current?.click()} disabled={busy} className="w-full justify-center">
            Take photo
          </Button>
          <Button type="button" variant="secondary" icon={ImagePlus} onClick={() => galleryRef.current?.click()} disabled={busy} className="w-full justify-center">
            {allowPdf ? "Choose file" : "Gallery"}
          </Button>
        </div>
      )}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void add(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept={allowPdf ? "image/jpeg,image/png,image/webp,application/pdf" : "image/jpeg,image/png,image/webp"}
        multiple={max > 1}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void add(e.target.files);
          e.target.value = "";
        }}
      />
      {hint && !problem && <p className="text-xs text-muted">{hint}</p>}
      {problem && (
        <p role="alert" className="text-xs font-medium text-danger-700">
          {problem}
        </p>
      )}
      {value.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {value.map((p) => (
            <li key={p.key} className="relative overflow-hidden rounded-lg border border-line bg-canvas">
              {p.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
                <img src={p.previewUrl} alt={`Preview of ${p.original.name || "photo"}`} className="h-28 w-full object-contain" />
              ) : (
                <div className="flex h-28 flex-col items-center justify-center gap-1 px-2 text-center text-xs text-muted">
                  <FileText size={22} aria-hidden />
                  <span className="line-clamp-2 break-all">{p.original.name}</span>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-line px-1.5 py-1 text-[11px] text-muted">
                <span>{(p.file.size / 1024).toFixed(0)} KB</span>
                <span className="flex gap-1">
                  {p.previewUrl && (
                    <button type="button" onClick={() => void rotate(p)} className="rounded p-1.5 hover:bg-white" aria-label="Rotate 90 degrees" disabled={busy}>
                      <RotateCw size={14} aria-hidden />
                    </button>
                  )}
                  <button type="button" onClick={() => remove(p)} className="rounded p-1.5 hover:bg-white" aria-label="Remove file">
                    <X size={14} aria-hidden />
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Upload progress bar with an accessible label. */
export function UploadProgress({ fraction }: { fraction: number | null }) {
  if (fraction === null) return null;
  const pct = Math.round(fraction * 100);
  return (
    <div className="space-y-1" aria-live="polite">
      <div className="h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Upload progress">
        <div className="h-full bg-brand-600 transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-muted">{pct < 100 ? `Uploading… ${pct}%` : "Processing…"}</p>
    </div>
  );
}
