"use client";

/**
 * Schematic map: plots coordinates on an equirectangular projection in SVG.
 * No map tiles or third-party map API are used (none are configured), so
 * this shows relative positions only, not streets.
 */
export interface MapPoint {
  lat: number;
  lng: number;
  label?: string;
  kind?: "depot" | "pickup" | "drop" | "node" | "vehicle";
}

export interface MapLine {
  points: Array<{ lat: number; lng: number }>;
  color?: string;
  dashed?: boolean;
  label?: string;
}

const PALETTE = ["#138075", "#c9822b", "#5b5bd6", "#c2410c", "#0e7490", "#a21caf", "#4d7c0f", "#be123c"];
export const routeColor = (i: number) => PALETTE[i % PALETTE.length];

export function RouteMap({ points, lines = [], height = 360 }: { points: MapPoint[]; lines?: MapLine[]; height?: number }) {
  const all = [...points, ...lines.flatMap((l) => l.points)];
  if (all.length === 0) return <div className="grid h-40 place-items-center text-sm text-muted">No coordinates to plot.</div>;
  const lats = all.map((p) => p.lat);
  const lngs = all.map((p) => p.lng);
  let [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const padLat = Math.max(0.01, (maxLat - minLat) * 0.08);
  const padLng = Math.max(0.01, (maxLng - minLng) * 0.08);
  minLat -= padLat;
  maxLat += padLat;
  minLng -= padLng;
  maxLng += padLng;
  const width = 800;
  const kx = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
  const spanX = (maxLng - minLng) * kx;
  const spanY = maxLat - minLat;
  const scale = Math.min(width / spanX, height / spanY);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  const x = (lng: number) => offX + (lng - minLng) * kx * scale;
  const y = (lat: number) => height - (offY + (lat - minLat) * scale);

  const labelled = new Set<string>();
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full rounded-md border border-line bg-[#f8fbfb]" role="img" aria-label="Schematic route map">
      {lines.map((l, i) => (
        <polyline
          key={i}
          points={l.points.map((p) => `${x(p.lng)},${y(p.lat)}`).join(" ")}
          fill="none"
          stroke={l.color ?? routeColor(i)}
          strokeWidth={l.dashed ? 1.5 : 3}
          strokeDasharray={l.dashed ? "5 5" : undefined}
          strokeLinejoin="round"
          opacity={0.85}
        >
          {l.label && <title>{l.label}</title>}
        </polyline>
      ))}
      {points.map((raw, i) => {
        // Several stops can share one place (e.g. depot start/end): label it once.
        const key = `${raw.lat.toFixed(5)},${raw.lng.toFixed(5)}`;
        const p = raw.label && labelled.has(key) && raw.kind !== "vehicle" ? { ...raw, label: undefined } : raw;
        if (raw.label) labelled.add(key);
        const cx = x(p.lng);
        const cy = y(p.lat);
        if (p.kind === "depot")
          return (
            <g key={i}>
              <rect x={cx - 6} y={cy - 6} width={12} height={12} fill="#08332f" />
              {p.label && <text x={cx + 9} y={cy + 4} fontSize={12} fill="#13212b">{p.label}</text>}
            </g>
          );
        if (p.kind === "vehicle")
          return (
            <g key={i}>
              <circle cx={cx} cy={cy} r={8} fill="#5b5bd6" stroke="white" strokeWidth={2} />
              {p.label && <text x={cx + 11} y={cy + 4} fontSize={12} fontWeight={600} fill="#3b3b9a">{p.label}</text>}
            </g>
          );
        const fill = p.kind === "pickup" ? "#c9822b" : p.kind === "drop" ? "#138075" : "#94a3b8";
        return (
          <g key={i}>
            <circle cx={cx} cy={cy} r={p.kind === "node" ? 3.5 : 5} fill={fill} />
            {p.label && <text x={cx + 7} y={cy + 4} fontSize={11} fill="#5b6b77">{p.label}</text>}
          </g>
        );
      })}
    </svg>
  );
}

export function MapLegend() {
  return (
    <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted">
      <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 bg-brand-900" /> Depot</span>
      <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-accent" /> Pickup</span>
      <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-brand-500" /> Drop</span>
      <span>Schematic positions (no map tiles); lines join stops in order, not actual roads.</span>
    </div>
  );
}
