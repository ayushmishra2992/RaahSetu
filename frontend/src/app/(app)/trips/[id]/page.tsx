"use client";

/* eslint-disable @next/next/no-img-element */
import { Check, CircleSlash, FileText, History, MapPinned, QrCode, ReceiptText, Truck, UserRound } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { MapLegend, RouteMap, type MapPoint } from "@/components/RouteMap";
import { Alert, Badge, Button, Card, Dialog, ErrorState, Field, Input, LinkButton, Loading, PageHeader, Stat, StatusBadge, SyntheticNote, cx, useConfirm, useToast } from "@/components/ds";
import { api, ApiError, errorMessage } from "@/lib/api";
import { fmtDateTime, fmtMinutes, fmtMoney, fmtNum, FUEL_UNIT, humanize } from "@/lib/format";
import type { TripDetail, TripStop } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const NEXT: Record<string, Array<{ to: string; label: string; variant?: "primary" | "danger" | "secondary" }>> = {
  PLANNED: [{ to: "DISPATCHED", label: "Dispatch" }, { to: "CANCELLED", label: "Cancel trip", variant: "danger" }],
  DISPATCHED: [{ to: "IN_TRANSIT", label: "Start trip" }, { to: "CANCELLED", label: "Cancel trip", variant: "danger" }],
  IN_TRANSIT: [{ to: "COMPLETED", label: "Complete trip" }, { to: "CANCELLED", label: "Abort trip", variant: "danger" }],
};

const LIFECYCLE = ["PLANNED", "DISPATCHED", "IN_TRANSIT", "COMPLETED"] as const;

export default function TripDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { me, can } = useAuth();
  const { data: t, error, loading, reload } = useApi<TripDetail>(`/trips/${id}`);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success" | "warning"; text: string } | null>(null);
  const [qr, setQr] = useState<{ url: string; dataUrl: string } | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();

  if (loading && !t) return <Loading variant="page" label="Loading trip…" />;
  if (error || !t) return <ErrorState message={error ?? "Not found"} onRetry={reload} />;

  const isDriver = me.user.role === "DRIVER";
  const canProgress = can("trips:progress");
  const actions = (NEXT[t.status] ?? []).filter((a) => !isDriver || a.to === "IN_TRANSIT" || a.to === "COMPLETED");
  const openStops = t.stops.filter((s) => (s.type === "PICKUP" || s.type === "DROP") && (s.status === "PENDING" || s.status === "ARRIVED")).length;

  async function run(key: string, fn: () => Promise<unknown>, success: string) {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: "success", text: success });
      setNote("");
      reload();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Someone else changed the trip (or a vehicle/driver/document blocks it): show why and refresh.
        setMsg({ kind: "warning", text: `${errorMessage(e)} The trip has been refreshed to show its current state.` });
        reload();
      } else setMsg({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function transition(a: { to: string; label: string }) {
    const go = () => run(a.to, () => api(`/trips/${t!.id}/status`, { body: { status: a.to, note: note || null } }), `Trip moved to ${humanize(a.to)}`);
    if (a.to === "CANCELLED") {
      const ok = await confirm({
        title: `${a.label} ${t!.tripNumber}?`,
        description: `Unfinished stops are marked skipped and their orders return to pending${t!.status === "PLANNED" ? "" : "; the vehicle and driver become available again"}. This can't be undone.`,
        confirmLabel: a.label,
        tone: "danger",
      });
      if (ok) await go();
    } else if (a.to === "COMPLETED") {
      const ok = await confirm({ title: `Complete ${t!.tripNumber}?`, description: "The trip is closed and the vehicle and driver become available again. Every pickup and drop must already be completed or skipped.", confirmLabel: "Complete trip", tone: "primary" });
      if (ok) await go();
    } else await go();
  }

  async function showQr() {
    setQrLoading(true);
    try {
      setQr(await api(`/trips/${t!.id}/qr`));
    } catch (e) {
      toast.error("Couldn't create the trip QR", errorMessage(e));
    } finally {
      setQrLoading(false);
    }
  }

  const points: MapPoint[] = t.stops.map((s) => ({
    lat: s.location.lat,
    lng: s.location.lng,
    label: `${s.sequence}. ${s.location.name}`,
    kind: s.type.startsWith("DEPOT") ? "depot" : s.type === "PICKUP" ? "pickup" : "drop",
  }));
  if (t.simulatedPosition) points.push({ lat: t.simulatedPosition.lat, lng: t.simulatedPosition.lng, kind: "vehicle", label: `${t.vehicle.registrationNumber} (sim.)` });

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Trip ${t.tripNumber}`}
        subtitle={
          <>
            {t.vehicle.registrationNumber} · {t.driver.name} · planned {fmtDateTime(t.plannedStart)}
            {t.optimizationRun && (
              <>
                {" "}· from <Link className="text-brand-700 hover:underline" href={`/optiroute/runs/${t.optimizationRun.id}`}>OptiRoute #{t.optimizationRun.id}</Link>
              </>
            )}
          </>
        }
        meta={<StatusBadge status={t.status} />}
        actions={
          <>
            <Button variant="secondary" icon={QrCode} loading={qrLoading} onClick={showQr}>
              Trip QR
            </Button>
            {can("billing:write") && t.status === "COMPLETED" && (
              <LinkButton href={`/billing?tripId=${t.id}`} variant="secondary" icon={ReceiptText}>
                Create invoice
              </LinkButton>
            )}
          </>
        }
      />

      <Lifecycle trip={t} />

      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      {canProgress && actions.length > 0 && (
        <Card title="Next step" description={t.status === "PLANNED" ? "Dispatch re-checks vehicle and driver availability and document validity, then marks both as on trip." : t.status === "IN_TRANSIT" ? (openStops ? `${openStops} pickup/drop stop(s) still open — complete or skip them before completing the trip.` : "All stops are done. The trip can be completed.") : undefined}>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[min(100%,15rem)] flex-1">
              <Field label="Note (optional)">
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. loaded at 08:10" maxLength={500} />
              </Field>
            </div>
            {actions.map((a) => (
              <Button key={a.to} variant={a.variant ?? "primary"} loading={busy === a.to} disabled={!!busy && busy !== a.to} onClick={() => transition(a)}>
                {a.label}
              </Button>
            ))}
          </div>
        </Card>
      )}

      <section aria-label="Trip estimates" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Planned distance" value={fmtNum(t.plannedDistanceKm, "km")} />
        <Stat label="Fuel / energy" value={fmtNum(t.estFuelUnits, FUEL_UNIT[t.vehicle.fuelType])} hint="Estimate" />
        <Stat label="Operating cost" value={fmtMoney(t.estCost)} hint="Estimate · fuel + driver" />
        <Stat label="CO₂" value={fmtNum(t.estCo2Kg, "kg")} hint="Estimate, not measured" />
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card title={`Stops (${t.stops.length})`} icon={MapPinned} description={t.status === "IN_TRANSIT" && canProgress ? "Record each arrival, pickup and delivery as it happens." : undefined}>
          <ol className="relative space-y-0">
            {t.stops.map((s, i) => (
              <StopItem
                key={s.id}
                stop={s}
                last={i === t.stops.length - 1}
                actionable={t.status === "IN_TRANSIT" && canProgress && (s.type === "PICKUP" || s.type === "DROP") && (s.status === "PENDING" || s.status === "ARRIVED")}
                busy={busy}
                onArrive={() => run(`a${s.id}`, () => api(`/trips/${t.id}/stops/${s.id}`, { body: { action: "ARRIVE" } }), "Arrival recorded")}
                onComplete={() => run(`c${s.id}`, () => api(`/trips/${t.id}/stops/${s.id}`, { body: { action: "COMPLETE" } }), s.type === "DROP" ? "Delivered" : "Picked up")}
                onSkip={async () => {
                  const ok = await confirm({ title: `Skip stop ${s.sequence}?`, description: `${s.location.name} is marked skipped and ${s.order ? `order ${s.order.orderNumber}` : "its order"} returns to pending${s.type === "PICKUP" ? " (its drop is skipped too)" : ""}.`, confirmLabel: "Skip stop", tone: "danger" });
                  if (ok) await run(`s${s.id}`, () => api(`/trips/${t.id}/stops/${s.id}`, { body: { action: "SKIP" } }), "Stop skipped; order returned to pending");
                }}
              />
            ))}
          </ol>
        </Card>

        <div className="space-y-5">
          <Card title="Route" icon={MapPinned} actions={t.simulatedPosition && <Badge color="amber">Simulated position</Badge>}>
            <RouteMap points={points} lines={[{ points: t.stops.map((s) => s.location) }]} height={300} />
            <MapLegend kinds={t.simulatedPosition ? ["depot", "pickup", "drop", "vehicle"] : ["depot", "pickup", "drop"]} />
            {t.simulatedPosition && (
              <div className="mt-2">
                <SyntheticNote>
                  Simulated from the planned schedule: {t.simulatedPosition.progressPct}% complete, next stop {t.simulatedPosition.nextStop ?? "—"}
                  {t.simulatedPosition.etaToNextStop ? ` (ETA ${fmtDateTime(t.simulatedPosition.etaToNextStop)})` : ""}
                  {t.simulatedPosition.delayMinutes > 0 ? `, ${fmtMinutes(t.simulatedPosition.delayMinutes)} behind plan` : ""}. No GPS device is connected.
                </SyntheticNote>
              </div>
            )}
          </Card>

          <Card title="Vehicle & driver" icon={Truck}>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted">Vehicle</dt>
                <dd className="font-medium text-ink">
                  {can("fleet:read") ? <Link className="text-brand-700 hover:underline" href={`/vehicles/${t.vehicle.id}`}>{t.vehicle.registrationNumber}</Link> : t.vehicle.registrationNumber}
                </dd>
                <dd className="text-xs text-muted">
                  {humanize(t.vehicle.type)} · {fmtNum(t.vehicle.capacityKg, "kg")} · {humanize(t.vehicle.fuelType)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Driver</dt>
                <dd className="flex items-center gap-1.5 font-medium text-ink">
                  <UserRound size={14} aria-hidden className="text-navy-400" />
                  {can("fleet:read") ? <Link className="text-brand-700 hover:underline" href={`/drivers/${t.driver.id}`}>{t.driver.name}</Link> : t.driver.name}
                </dd>
                <dd className="text-xs text-muted">{t.driver.phone}</dd>
              </div>
            </dl>
            {t.notes && <p className="mt-3 rounded-md bg-surface-muted p-2.5 text-sm text-muted">{t.notes}</p>}
          </Card>

          <Card title="Status history" icon={History} description="Every transition with its note">
            <ol className="space-y-3 text-sm">
              {t.events.map((e) => (
                <li key={e.id} className="flex gap-2.5">
                  <span aria-hidden className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", e.toStatus === "CANCELLED" ? "bg-danger-600" : "bg-brand-500")} />
                  <div>
                    <span className="font-medium text-ink">
                      {e.fromStatus ? `${humanize(e.fromStatus)} → ` : ""}
                      {humanize(e.toStatus)}
                    </span>
                    <div className="text-xs text-muted">
                      {fmtDateTime(e.createdAt)}
                      {e.note ? ` · ${e.note}` : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          <Card title="Billing documents" icon={FileText}>
            {t.billingDocuments.length === 0 ? (
              <p className="text-sm text-muted">{t.status === "COMPLETED" ? "No invoice or challan yet." : "Invoices and challans can be created once the trip is completed."}</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {t.billingDocuments.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-2 py-2">
                    <span>
                      <Link href={`/billing/${b.id}`} className="font-medium text-brand-700 hover:underline">{b.number}</Link>
                      <span className="block text-xs text-muted">
                        {humanize(b.kind)} · {fmtMoney(b.total)}
                      </span>
                    </span>
                    <StatusBadge status={b.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Dialog open={!!qr} onClose={() => setQr(null)} title="Trip verification QR" description="Checkpoints can scan this to confirm the trip exists in RaahSetu." size="sm">
        {qr && (
          <div className="flex flex-col items-center gap-3 text-sm">
            <img src={qr.dataUrl} alt={`Verification QR code for trip ${t.tripNumber}`} width={200} height={200} className="rounded-md border border-line" />
            <a href={qr.url} target="_blank" rel="noreferrer" className="break-all text-center text-xs text-brand-700 underline">{qr.url}</a>
            <p className="text-center text-xs text-muted">The public page shows minimal trip details only.</p>
          </div>
        )}
      </Dialog>
    </div>
  );
}

function Lifecycle({ trip }: { trip: TripDetail }) {
  const at = (s: string) => [...trip.events].reverse().find((e) => e.toStatus === s)?.createdAt;
  const cancelled = trip.status === "CANCELLED";
  const idx = (s: string | null) => LIFECYCLE.indexOf(s as (typeof LIFECYCLE)[number]);
  // Cancelled: every stage the trip had reached before cancellation counts as done.
  const reached = cancelled ? Math.max(-1, ...trip.events.filter((e) => e.toStatus === "CANCELLED").map((e) => idx(e.fromStatus))) + 1 : idx(trip.status);
  return (
    <nav aria-label="Trip progress" className="overflow-x-auto rounded-lg border border-line bg-surface px-4 py-3 shadow-xs">
      <ol className="flex min-w-max items-center gap-2 text-xs sm:min-w-0">
        {LIFECYCLE.map((s, i) => {
          const done = i < reached || (!cancelled && i === reached && s === "COMPLETED");
          const current = !cancelled && i === reached && s !== "COMPLETED";
          return (
            <li key={s} className="flex flex-1 items-center gap-2" aria-current={current ? "step" : undefined}>
              <span className={cx("grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold", done ? "border-brand-600 bg-brand-600 text-white" : current ? "border-brand-600 bg-brand-50 text-brand-700" : "border-line-strong text-subtle")}>
                {done ? <Check size={13} aria-hidden /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className={cx("block font-medium", done || current ? "text-ink" : "text-muted")}>{humanize(s)}</span>
                <span className="block text-muted">{at(s) ? fmtDateTime(at(s)) : current ? "Current" : "—"}</span>
              </span>
              {i < LIFECYCLE.length - 1 && <span aria-hidden className={cx("mx-1 hidden h-px flex-1 sm:block", i < reached ? "bg-brand-500" : "bg-line-strong")} />}
            </li>
          );
        })}
        {cancelled && (
          <li className="flex items-center gap-2 font-medium text-danger-700" aria-current="step">
            <CircleSlash size={16} aria-hidden />
            Cancelled {at("CANCELLED") ? fmtDateTime(at("CANCELLED")) : ""}
          </li>
        )}
      </ol>
    </nav>
  );
}

function StopItem({
  stop: s,
  last,
  actionable,
  busy,
  onArrive,
  onComplete,
  onSkip,
}: {
  stop: TripStop;
  last: boolean;
  actionable: boolean;
  busy: string | null;
  onArrive: () => void;
  onComplete: () => void;
  onSkip: () => void;
}) {
  const late = s.type === "DROP" && s.order?.windowEnd && s.actualArrival ? new Date(s.actualArrival) > new Date(s.order.windowEnd) : false;
  const done = s.status === "COMPLETED";
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {!last && <span aria-hidden className="absolute left-[13px] top-7 h-[calc(100%-1.25rem)] w-px bg-line" />}
      <span
        aria-hidden
        className={cx(
          "relative z-[1] grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[11px] font-semibold",
          done ? "border-brand-600 bg-brand-600 text-white" : s.status === "SKIPPED" ? "border-line-strong bg-navy-50 text-subtle" : s.status === "ARRIVED" ? "border-violet-600 bg-violet-50 text-violet-700" : "border-line-strong bg-surface text-muted",
        )}
      >
        {done ? <Check size={13} /> : s.sequence}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <div className="min-w-0">
            <p className="font-medium text-ink">
              <span className="sr-only">Stop {s.sequence}: </span>
              {humanize(s.type)} · {s.location.name}
            </p>
            {s.order && (
              <p className="text-xs text-muted">
                {s.order.orderNumber} · {s.order.customerName} · {fmtNum(s.order.weightKg, "kg")}
              </p>
            )}
          </div>
          <span className="flex items-center gap-1.5">
            {late && <Badge color="red">Late</Badge>}
            <StatusBadge status={s.status} />
          </span>
        </div>
        <p className="mt-1 text-xs text-muted">
          Planned {fmtDateTime(s.plannedArrival)}
          {s.actualArrival && <> · actual {fmtDateTime(s.actualArrival)}</>}
          {s.type === "DROP" && s.order?.windowEnd && <> · deliver by {fmtDateTime(s.order.windowEnd)}</>}
        </p>
        {actionable && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {s.status === "PENDING" && (
              <Button size="sm" variant="secondary" loading={busy === `a${s.id}`} onClick={onArrive}>
                Arrived
              </Button>
            )}
            <Button size="sm" loading={busy === `c${s.id}`} onClick={onComplete}>
              {s.type === "DROP" ? "Delivered" : "Picked up"}
            </Button>
            <Button size="sm" variant="ghost" loading={busy === `s${s.id}`} onClick={onSkip}>
              Skip
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}
