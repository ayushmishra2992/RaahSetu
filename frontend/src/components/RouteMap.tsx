"use client";

/**
 * Route map used by Dashboard, Locations & Roads, OptiRoute and Trip Details.
 *
 * Renders an interactive Leaflet map on OpenStreetMap tiles (configurable via
 * NEXT_PUBLIC_MAP_TILE_URL / NEXT_PUBLIC_MAP_ATTRIBUTION). If tiles are disabled
 * or cannot load, it falls back to the schematic SVG projection below.
 *
 * Route lines are always straight segments between stops in sequence — a
 * schematic of stop order, not road navigation.
 */
import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import { dedupeLabels, isValidCoord, KIND_STYLES, resolveTileConfig, type MapPointKind } from "@/lib/map";

export interface MapPoint {
  lat: number;
  lng: number;
  label?: string;
  kind?: MapPointKind;
}

export interface MapLine {
  points: Array<{ lat: number; lng: number }>;
  color?: string;
  dashed?: boolean;
  label?: string;
}

const PALETTE = ["#138075", "#c9822b", "#5b5bd6", "#c2410c", "#0e7490", "#a21caf", "#4d7c0f", "#be123c"];
export const routeColor = (i: number) => PALETTE[i % PALETTE.length];

// NEXT_PUBLIC_* values are inlined at build time; they must be referenced literally.
const TILES = resolveTileConfig(process.env.NEXT_PUBLIC_MAP_TILE_URL, process.env.NEXT_PUBLIC_MAP_ATTRIBUTION, process.env.NEXT_PUBLIC_MAP_MAX_ZOOM);

const LeafletMap = dynamic(() => import("./LeafletMap"), {
  ssr: false,
  loading: () => <MapPlaceholder text="Loading map…" />,
});

function MapPlaceholder({ text, height = 360 }: { text: string; height?: number }) {
  return (
    <div style={{ height }} className="grid w-full place-items-center rounded-md border border-line bg-[#f8fbfb] text-sm text-muted">
      {text}
    </div>
  );
}

export function RouteMap({ points, lines = [], height = 360 }: { points: MapPoint[]; lines?: MapLine[]; height?: number }) {
  const [tilesFailed, setTilesFailed] = useState(false);
  const onTilesFailed = useCallback(() => setTilesFailed(true), []);

  const hasCoords = points.some(isValidCoord) || lines.some((l) => l.points.some(isValidCoord));
  if (!hasCoords) return <div className="grid h-40 place-items-center text-sm text-muted">No coordinates to plot.</div>;

  if (TILES.url && !tilesFailed) {
    return <LeafletMap points={points} lines={lines} height={height} tiles={{ ...TILES, url: TILES.url }} onTilesFailed={onTilesFailed} />;
  }
  return (
    <div>
      <SchematicMap points={points} lines={lines} height={height} />
      <p className="mt-1 text-xs text-amber-700">
        {TILES.url ? "Map tiles could not be loaded (offline or blocked) — showing schematic positions instead." : "Map tiles are disabled — showing schematic positions."}
      </p>
    </div>
  );
}

/** Fallback: plots coordinates on an equirectangular projection in SVG (relative positions only, no streets). */
export function SchematicMap({ points, lines = [], height = 360 }: { points: MapPoint[]; lines?: MapLine[]; height?: number }) {
  const validPoints = points.filter(isValidCoord);
  const validLines = lines.map((l) => ({ ...l, points: l.points.filter(isValidCoord) }));
  const all = [...validPoints, ...validLines.flatMap((l) => l.points)];
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

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full rounded-md border border-line bg-[#f8fbfb]" role="img" aria-label="Schematic route map">
      {validLines.map((l, i) => (
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
      {dedupeLabels(validPoints).map((p, i) => {
        const style = KIND_STYLES[p.kind ?? "node"];
        const cx = x(p.lng);
        const cy = y(p.lat);
        const r = style.radius;
        const shape =
          style.shape === "square" ? (
            <rect x={cx - r + 1} y={cy - r + 1} width={(r - 1) * 2} height={(r - 1) * 2} fill={style.color} />
          ) : style.shape === "diamond" ? (
            <rect x={cx - r + 2} y={cy - r + 2} width={(r - 2) * 2} height={(r - 2) * 2} fill={style.color} transform={`rotate(45 ${cx} ${cy})`} />
          ) : style.shape === "vehicle" ? (
            <circle cx={cx} cy={cy} r={r} fill={style.color} stroke="white" strokeWidth={2} />
          ) : (
            <circle cx={cx} cy={cy} r={p.kind === "node" ? 3.5 : 5} fill={style.color} />
          );
        return (
          <g key={i}>
            {shape}
            {p.label && (
              <text x={cx + r + 3} y={cy + 4} fontSize={p.kind === "node" ? 11 : 12} fontWeight={p.kind === "vehicle" ? 600 : undefined} fill="#13212b">
                {p.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function LegendSwatch({ kind }: { kind: MapPointKind }) {
  const s = KIND_STYLES[kind];
  const base = "inline-block h-2.5 w-2.5";
  const cls = s.shape === "square" ? base : s.shape === "diamond" ? `${base} rotate-45 scale-90` : `${base} rounded-full`;
  return (
    <span className="flex items-center gap-1">
      <span className={cls} style={{ background: s.color }} /> {s.label}
    </span>
  );
}

/** Legend for the marker kinds shown. Default kinds match route maps (depot / pickup / drop). */
export function MapLegend({ kinds = ["depot", "pickup", "drop"] }: { kinds?: MapPointKind[] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {kinds.map((k) => (
        <LegendSwatch key={k} kind={k} />
      ))}
      <span>Lines are straight segments between stops (schematic) — not road routes or turn-by-turn navigation.</span>
    </div>
  );
}
