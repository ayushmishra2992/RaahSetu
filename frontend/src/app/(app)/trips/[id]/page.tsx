"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { MapLegend, RouteMap, type MapPoint } from "@/components/RouteMap";
import { Alert, Badge, Button, Card, ErrorState, Field, Input, Loading, PageHeader, Stat, StatusBadge, SyntheticNote, Table, Td } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime, fmtMoney, fmtNum, FUEL_UNIT, humanize } from "@/lib/format";
import type { TripDetail } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const NEXT: Record<string, Array<{ to: string; label: string; variant?: "primary" | "danger" | "secondary" }>> = {
  PLANNED: [{ to: "DISPATCHED", label: "Dispatch" }, { to: "CANCELLED", label: "Cancel trip", variant: "danger" }],
  DISPATCHED: [{ to: "IN_TRANSIT", label: "Start trip" }, { to: "CANCELLED", label: "Cancel trip", variant: "danger" }],
  IN_TRANSIT: [{ to: "COMPLETED", label: "Complete trip" }, { to: "CANCELLED", label: "Abort trip", variant: "danger" }],
};

export default function TripDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { me, can } = useAuth();
  const { data: t, error, loading, reload } = useApi<TripDetail>(`/trips/${id}`);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [qr, setQr] = useState<{ url: string; dataUrl: string } | null>(null);

  if (loading) return <Loading />;
  if (error || !t) return <ErrorState message={error ?? "Not found"} onRetry={reload} />;

  const isDriver = me.user.role === "DRIVER";
  const canProgress = can("trips:progress");
  const actions = (NEXT[t.status] ?? []).filter((a) => !isDriver || a.to === "IN_TRANSIT" || a.to === "COMPLETED");

  async function run(key: string, fn: () => Promise<unknown>, success: string) {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: "success", text: success });
      setNote("");
      reload();
    } catch (e) {
      setMsg({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(null);
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
        subtitle={<>{t.vehicle.registrationNumber} · {t.driver.name} · planned {fmtDateTime(t.plannedStart)}{t.optimizationRun && <> · from <Link className="text-brand-700" href={`/optiroute/runs/${t.optimizationRun.id}`}>OptiRoute #{t.optimizationRun.id}</Link></>}</>}
        actions={<>
          <StatusBadge status={t.status} />
          <Button variant="secondary" onClick={async () => setQr(await api(`/trips/${t.id}/qr`))}>Trip QR</Button>
          {can("billing:write") && t.status === "COMPLETED" && <Link href={`/billing?tripId=${t.id}`} className="rounded-md border border-line bg-white px-3.5 py-2 text-sm font-medium hover:bg-canvas">Create invoice</Link>}
        </>}
      />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      {canProgress && actions.length > 0 && (
        <Card title="Next step">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[240px] flex-1"><Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. loaded at 08:10" /></Field></div>
            {actions.map((a) => (
              <Button key={a.to} variant={a.variant ?? "primary"} loading={busy === a.to} onClick={() => run(a.to, () => api(`/trips/${t.id}/status`, { body: { status: a.to, note: note || null } }), `Trip moved to ${humanize(a.to)}`)}>
                {a.label}
              </Button>
            ))}
          </div>
          {t.status === "PLANNED" && <p className="mt-2 text-xs text-muted">Dispatch re-checks vehicle/driver availability and document validity, then marks both as on trip.</p>}
          {t.status === "IN_TRANSIT" && <p className="mt-2 text-xs text-muted">Complete or skip every pickup/drop below before completing the trip.</p>}
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Planned distance" value={fmtNum(t.plannedDistanceKm, "km")} />
        <Stat label="Est. fuel/energy" value={fmtNum(t.estFuelUnits, FUEL_UNIT[t.vehicle.fuelType])} hint="Estimate" />
        <Stat label="Est. operating cost" value={fmtMoney(t.estCost)} hint="Fuel + driver time" />
        <Stat label="Est. CO₂" value={fmtNum(t.estCo2Kg, "kg")} hint="Estimate, not measured" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <Card title="Stops">
          <Table head={["#", "Stop", "Order", "Planned", "Actual", "Status", ""]}>
            {t.stops.map((s) => {
              const late = s.type === "DROP" && s.order?.windowEnd && (s.actualArrival ? new Date(s.actualArrival) > new Date(s.order.windowEnd) : false);
              const actionable = t.status === "IN_TRANSIT" && canProgress && (s.type === "PICKUP" || s.type === "DROP") && (s.status === "PENDING" || s.status === "ARRIVED");
              return (
                <tr key={s.id}>
                  <Td>{s.sequence}</Td>
                  <Td><span className="font-medium">{humanize(s.type)}</span><div className="text-xs text-muted">{s.location.name}</div></Td>
                  <Td className="text-xs">{s.order ? <>{s.order.orderNumber}<div className="text-muted">{s.order.customerName} · {s.order.weightKg} kg</div></> : "—"}</Td>
                  <Td className="text-xs">{fmtDateTime(s.plannedArrival)}</Td>
                  <Td className="text-xs">{fmtDateTime(s.actualArrival)} {late && <Badge color="red">Late</Badge>}</Td>
                  <Td><StatusBadge status={s.status} /></Td>
                  <Td>{actionable && (
                    <span className="flex flex-wrap gap-1">
                      {s.status === "PENDING" && <Button variant="secondary" loading={busy === `a${s.id}`} onClick={() => run(`a${s.id}`, () => api(`/trips/${t.id}/stops/${s.id}`, { body: { action: "ARRIVE" } }), "Arrival recorded")}>Arrived</Button>}
                      <Button loading={busy === `c${s.id}`} onClick={() => run(`c${s.id}`, () => api(`/trips/${t.id}/stops/${s.id}`, { body: { action: "COMPLETE" } }), s.type === "DROP" ? "Delivered" : "Picked up")}>{s.type === "DROP" ? "Delivered" : "Picked up"}</Button>
                      <Button variant="ghost" loading={busy === `s${s.id}`} onClick={() => run(`s${s.id}`, () => api(`/trips/${t.id}/stops/${s.id}`, { body: { action: "SKIP" } }), "Stop skipped; order returned to pending")}>Skip</Button>
                    </span>
                  )}</Td>
                </tr>
              );
            })}
          </Table>
        </Card>
        <div className="space-y-5">
          <Card title="Route" actions={t.simulatedPosition && <Badge color="amber">Simulated position</Badge>}>
            <RouteMap points={points} lines={[{ points: t.stops.map((s) => s.location) }]} height={300} />
            <MapLegend />
            {t.simulatedPosition && (
              <div className="mt-2"><SyntheticNote>Simulated from the planned schedule: {t.simulatedPosition.progressPct}% complete, next stop {t.simulatedPosition.nextStop ?? "—"}. No GPS device is connected.</SyntheticNote></div>
            )}
          </Card>
          <Card title="Status timeline">
            <ol className="space-y-2 text-sm">
              {t.events.map((e) => (
                <li key={e.id} className="flex gap-2">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
                  <div>
                    <span className="font-medium">{e.fromStatus ? `${humanize(e.fromStatus)} → ` : ""}{humanize(e.toStatus)}</span>
                    <div className="text-xs text-muted">{fmtDateTime(e.createdAt)}{e.note ? ` · ${e.note}` : ""}</div>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
          {t.billingDocuments.length > 0 && (
            <Card title="Billing">
              <ul className="space-y-1 text-sm">{t.billingDocuments.map((b) => <li key={b.id}><Link href={`/billing/${b.id}`} className="text-brand-700">{b.number}</Link> · {humanize(b.kind)} · {fmtMoney(b.total)} · <StatusBadge status={b.status} /></li>)}</ul>
            </Card>
          )}
        </div>
      </div>

      {qr && (
        <Card title="Trip verification QR" actions={<Button variant="ghost" onClick={() => setQr(null)}>Hide</Button>}>
          <div className="flex flex-wrap items-center gap-4">
            <img src={qr.dataUrl} alt="Trip verification QR code" width={180} height={180} />
            <div className="text-sm">
              <p>Checkpoints can scan this to confirm the trip exists in RaahSetu.</p>
              <a href={qr.url} target="_blank" rel="noreferrer" className="break-all text-brand-700">{qr.url}</a>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
