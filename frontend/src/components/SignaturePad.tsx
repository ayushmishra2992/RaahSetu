"use client";

import { Eraser } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "./ds";

/**
 * Finger/stylus/mouse signature capture (Pointer Events). Produces a PNG with a
 * white background so it prints cleanly on the POD. `onChange(null)` when cleared.
 *
 * The backing canvas is sized from its displayed size × devicePixelRatio. Inside a
 * dialog the pad can mount before it has been laid out (0×0), so sizing happens
 * whenever it gets real dimensions and again at the start of a stroke — a 0×0
 * canvas would otherwise silently produce no image.
 */
export function SignaturePad({ onChange, label = "Receiver's signature" }: { onChange: (png: File | null) => void; label?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);
  /** True only once the PNG has actually been produced and handed to the form. */
  const [captured, setCaptured] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  /** (Re)size the backing store to the displayed size. Clears the pad, so only call it while empty. */
  const fit = () => {
    const c = canvasRef.current;
    if (!c) return false;
    const r = c.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.round(r.width * dpr);
    const h = Math.round(r.height * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, r.width, r.height);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
    return true;
  };

  useEffect(() => {
    const c = canvasRef.current!;
    fit();
    // Size again once the dialog has laid the pad out, or when the phone rotates —
    // but never wipe a signature that is already there.
    const ro = new ResizeObserver(() => {
      if (!hasInk.current) fit();
    });
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const finish = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    const c = canvasRef.current!;
    c.toBlob((b) => {
      if (b && b.size > 0) {
        setProblem(null);
        setCaptured(true);
        onChangeRef.current(new File([b], "signature.png", { type: "image/png" }));
      } else {
        setProblem("The signature could not be captured on this device. Clear the box and sign again.");
        setCaptured(false);
        onChangeRef.current(null);
      }
    }, "image/png");
  };

  const clear = () => {
    hasInk.current = false;
    fit();
    setEmpty(true);
    setCaptured(false);
    setProblem(null);
    onChangeRef.current(null);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-ink">{label}</span>
        <Button type="button" size="sm" variant="ghost" icon={Eraser} onClick={clear} disabled={empty}>
          Clear
        </Button>
      </div>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={captured ? `${label}: signed` : empty ? `${label}: empty. Sign inside the box with a finger or stylus.` : `${label}: signing…`}
        className="h-40 w-full touch-none rounded-lg border-2 border-dashed border-line bg-white"
        onPointerDown={(e) => {
          // First stroke: make sure the canvas has real pixels (it may have mounted at 0×0).
          if (!hasInk.current && !fit()) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          last.current = point(e);
        }}
        onPointerMove={(e) => {
          if (!drawing.current || !last.current) return;
          const p = point(e);
          const ctx = e.currentTarget.getContext("2d")!;
          ctx.beginPath();
          ctx.moveTo(last.current.x, last.current.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          last.current = p;
          hasInk.current = true;
          if (empty) setEmpty(false);
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onPointerLeave={finish}
      />
      {problem ? (
        <p role="alert" className="text-xs font-medium text-danger-700">
          {problem}
        </p>
      ) : (
        <p className="text-xs text-muted">{captured ? "Signature captured." : "Ask the receiver to sign inside the box."}</p>
      )}
    </div>
  );
}
