/**
 * TELEMETRY SIMULATOR — no GPS provider is integrated. For IN_TRANSIT trips we
 * interpolate a position along the planned stop sequence using elapsed time.
 * Everything returned here is labelled `simulated: true` and must never be
 * presented as a live GPS fix. Replace `simulatePosition` with a real
 * telemetry adapter when a provider and credentials are available.
 */
export interface StopPoint {
  lat: number;
  lng: number;
  plannedArrival: Date | null;
  name: string;
}

export interface SimulatedPosition {
  simulated: true;
  lat: number;
  lng: number;
  progressPct: number;
  nextStop: string | null;
  etaToNextStop: string | null;
  delayMinutes: number;
}

export function simulatePosition(stops: StopPoint[], plannedStart: Date, actualStart: Date | null, now = new Date()): SimulatedPosition | null {
  const timed = stops.filter((s) => s.plannedArrival);
  if (timed.length < 2 || !actualStart) return null;
  const shiftMs = actualStart.getTime() - plannedStart.getTime();
  const times = timed.map((s) => s.plannedArrival!.getTime() + shiftMs);
  const t = now.getTime();
  const total = times[times.length - 1] - times[0];
  if (t <= times[0]) {
    return { simulated: true, lat: timed[0].lat, lng: timed[0].lng, progressPct: 0, nextStop: timed[1].name, etaToNextStop: new Date(times[1]).toISOString(), delayMinutes: Math.round(shiftMs / 60000) };
  }
  for (let i = 1; i < timed.length; i++) {
    if (t <= times[i]) {
      const f = (t - times[i - 1]) / Math.max(1, times[i] - times[i - 1]);
      return {
        simulated: true,
        lat: timed[i - 1].lat + (timed[i].lat - timed[i - 1].lat) * f,
        lng: timed[i - 1].lng + (timed[i].lng - timed[i - 1].lng) * f,
        progressPct: Math.round(((t - times[0]) / Math.max(1, total)) * 100),
        nextStop: timed[i].name,
        etaToNextStop: new Date(times[i]).toISOString(),
        delayMinutes: Math.round(shiftMs / 60000),
      };
    }
  }
  const last = timed[timed.length - 1];
  return { simulated: true, lat: last.lat, lng: last.lng, progressPct: 100, nextStop: null, etaToNextStop: null, delayMinutes: Math.round((t - times[times.length - 1] + shiftMs) / 60000) };
}
