/**
 * Map helpers shared by the Leaflet map and the schematic SVG fallback.
 * Pure functions only (no Leaflet / DOM imports) so they are unit-testable.
 */

export type MapPointKind = "depot" | "warehouse" | "pickup" | "drop" | "customer" | "other" | "node" | "vehicle";

export interface KindStyle {
  label: string;
  color: string;
  /** Marker shape: square (depot), diamond (warehouse), dot (default), vehicle (ring). */
  shape: "square" | "diamond" | "dot" | "vehicle";
  radius: number;
}

export const KIND_STYLES: Record<MapPointKind, KindStyle> = {
  depot: { label: "Depot", color: "#08332f", shape: "square", radius: 7 },
  warehouse: { label: "Warehouse", color: "#7c3aed", shape: "diamond", radius: 7 },
  pickup: { label: "Pickup", color: "#c9822b", shape: "dot", radius: 6 },
  drop: { label: "Drop", color: "#138075", shape: "dot", radius: 6 },
  customer: { label: "Customer", color: "#0e7490", shape: "dot", radius: 6 },
  other: { label: "Other location", color: "#64748b", shape: "dot", radius: 5 },
  node: { label: "Road junction", color: "#94a3b8", shape: "dot", radius: 3.5 },
  vehicle: { label: "Vehicle (simulated)", color: "#5b5bd6", shape: "vehicle", radius: 8 },
};

/** Map a Location.type from the API to a marker kind. */
export function locationKind(type: string): MapPointKind {
  switch (type) {
    case "DEPOT":
      return "depot";
    case "WAREHOUSE":
      return "warehouse";
    case "CUSTOMER":
      return "customer";
    default:
      return "other";
  }
}

export const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

export interface TileConfig {
  /** null = tiles disabled; render the schematic map. */
  url: string | null;
  attribution: string;
  maxZoom: number;
}

/**
 * Resolve tile settings from NEXT_PUBLIC_MAP_* values.
 * - unset → OpenStreetMap standard tiles with OSM attribution
 * - "none" / "off" / "false" → no tiles (schematic map only)
 * - any other value must be an https:// (or http://localhost) template with {z}/{x}/{y}
 * Attribution can never be blanked: an empty value falls back to the OSM credit.
 */
export function resolveTileConfig(rawUrl: string | undefined, rawAttribution: string | undefined, rawMaxZoom?: string): TileConfig {
  const attribution = rawAttribution?.trim() || OSM_ATTRIBUTION;
  const z = Number(rawMaxZoom);
  const maxZoom = Number.isInteger(z) && z >= 1 && z <= 22 ? z : 19;
  const url = rawUrl?.trim();
  if (url === undefined || url === "") return { url: OSM_TILE_URL, attribution, maxZoom };
  if (/^(none|off|false|disabled?)$/i.test(url)) return { url: null, attribution, maxZoom };
  const valid = /^(https:\/\/|http:\/\/localhost[:/])/i.test(url) && url.includes("{z}") && url.includes("{x}") && url.includes("{y}");
  return { url: valid ? url : OSM_TILE_URL, attribution, maxZoom };
}

/**
 * Several stops often share one place (e.g. depot start and end of a route).
 * Keep the label only on the first point at each coordinate; vehicles always keep theirs.
 */
export function dedupeLabels<T extends { lat: number; lng: number; label?: string; kind?: MapPointKind }>(points: T[]): T[] {
  const labelled = new Set<string>();
  return points.map((p) => {
    const key = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
    const out = p.label && labelled.has(key) && p.kind !== "vehicle" ? { ...p, label: undefined } : p;
    if (p.label) labelled.add(key);
    return out;
  });
}

/** True for finite, in-range WGS84 coordinates. */
export function isValidCoord<T extends { lat: number; lng: number }>(p: T | null | undefined): p is T {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

/** Stable signature of a coordinate set — used to refit the view only when the plotted area changes. */
export function coordSignature(coords: Array<{ lat: number; lng: number }>): string {
  return coords.map((c) => `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`).join(";");
}
