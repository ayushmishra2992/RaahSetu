"use client";

/**
 * Interactive Leaflet map. Loaded only in the browser (via next/dynamic with
 * ssr:false from RouteMap) because Leaflet touches `window` at import time.
 *
 * OpenStreetMap tile usage policy (operations.osmfoundation.org/policies/tiles):
 * - attribution stays visible in the bottom-right control (cannot be removed here);
 * - tiles are requested only for the area the user is viewing — no prefetching,
 *   no offline caching; the browser's HTTP cache honours the server's cache headers;
 * - the tile URL is configurable so production can switch provider without a code change.
 */
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";
import { coordSignature, dedupeLabels, isValidCoord, KIND_STYLES, type KindStyle, type TileConfig } from "@/lib/map";
import type { MapLine, MapPoint } from "./RouteMap";

/** Tooltip content as a DOM node so user-entered names are never parsed as HTML. */
function textNode(text: string): HTMLElement {
  const el = document.createElement("span");
  el.textContent = text;
  return el;
}

function markerFor(p: MapPoint, style: KindStyle): L.Layer {
  const latlng: L.LatLngExpression = [p.lat, p.lng];
  if (style.shape === "dot") {
    return L.circleMarker(latlng, { radius: style.radius, color: "#ffffff", weight: 1.5, fillColor: style.color, fillOpacity: 1 });
  }
  const size = style.radius * 2 + 4;
  const shapeCss =
    style.shape === "square"
      ? `background:${style.color};border:2px solid #fff;`
      : style.shape === "diamond"
        ? `background:${style.color};border:2px solid #fff;transform:rotate(45deg) scale(0.85);`
        : `background:${style.color};border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 2px ${style.color}66;`;
  return L.marker(latlng, {
    icon: L.divIcon({
      className: "rs-map-marker",
      html: `<div style="width:${size}px;height:${size}px;box-sizing:border-box;${shapeCss}box-shadow:0 1px 3px rgba(0,0,0,.35)"></div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    }),
    keyboard: false,
    zIndexOffset: style.shape === "vehicle" ? 1000 : style.shape === "square" ? 500 : 0,
  });
}

export default function LeafletMap({
  points,
  lines,
  height,
  tiles,
  onTilesFailed,
}: {
  points: MapPoint[];
  lines: MapLine[];
  height: number;
  tiles: TileConfig & { url: string };
  onTilesFailed: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fittedRef = useRef<string>("");
  const failedRef = useRef(onTilesFailed);
  useEffect(() => {
    failedRef.current = onTilesFailed;
  }, [onTilesFailed]);

  // Create the map once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const map = L.map(el, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: false, // enabled after the user clicks the map, so page scrolling is not hijacked
      worldCopyJump: false,
    });
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>');
    map.on("click focus", () => map.scrollWheelZoom.enable());
    map.on("blur mouseout", () => map.scrollWheelZoom.disable());

    let loaded = 0;
    let errors = 0;
    let failed = false;
    const fail = () => {
      if (failed || loaded > 0) return;
      failed = true;
      failedRef.current();
    };
    L.tileLayer(tiles.url, { attribution: tiles.attribution, maxZoom: tiles.maxZoom })
      .on("tileload", () => (loaded += 1))
      .on("tileerror", () => {
        errors += 1;
        if (errors >= 4) fail();
      })
      .addTo(map);
    // Nothing loaded at all after 12 s (blocked/offline): fall back.
    const timer = window.setTimeout(fail, 12_000);

    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      window.clearTimeout(timer);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      fittedRef.current = "";
    };
  }, [tiles.url, tiles.attribution, tiles.maxZoom]);

  // Redraw markers and lines whenever the data changes; refit only when the plotted area changes.
  useEffect(() => {
    const map = mapRef.current;
    const group = layerRef.current;
    if (!map || !group) return;
    group.clearLayers();

    lines.forEach((l) => {
      const pts = l.points.filter(isValidCoord).map((p) => [p.lat, p.lng] as L.LatLngTuple);
      if (pts.length < 2) return;
      const line = L.polyline(pts, {
        color: l.color ?? "#138075",
        weight: l.dashed ? 3 : 4,
        opacity: l.dashed ? 0.95 : 0.85,
        dashArray: l.dashed ? "6 6" : undefined,
        lineJoin: "round",
      });
      if (l.label) line.bindTooltip(textNode(`${l.label} — straight-line (schematic), not road route`), { sticky: true });
      line.addTo(group);
    });

    const valid = dedupeLabels(points.filter(isValidCoord));
    // Junction names are hover-only; other labels stay visible unless there are too many to read.
    const permanent = valid.filter((p) => p.label && p.kind !== "node").length <= 12;
    for (const p of valid) {
      const style = KIND_STYLES[p.kind ?? "node"];
      const marker = markerFor(p, style);
      const text = p.label ? `${p.label} (${style.label})` : style.label;
      if (marker instanceof L.Marker || marker instanceof L.CircleMarker) {
        marker.bindTooltip(textNode(p.label ?? text), {
          permanent: permanent && !!p.label && p.kind !== "node",
          direction: "right",
          offset: [style.radius + 2, 0],
          className: "rs-map-label",
        });
        if (p.label) marker.bindPopup(textNode(text));
      }
      marker.addTo(group);
    }

    const coords = [...valid, ...lines.flatMap((l) => l.points.filter(isValidCoord))];
    const sig = coordSignature(coords);
    if (coords.length > 0 && sig !== fittedRef.current) {
      fittedRef.current = sig;
      const bounds = L.latLngBounds(coords.map((c) => [c.lat, c.lng] as L.LatLngTuple));
      if (bounds.getNorthEast().equals(bounds.getSouthWest())) map.setView(bounds.getCenter(), 14);
      else map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });
    }
  }, [points, lines]);

  return (
    <div
      ref={containerRef}
      style={{ height }}
      className="relative z-0 w-full overflow-hidden rounded-md border border-line bg-[#f8fbfb]"
      role="region"
      aria-label="Interactive route map"
    />
  );
}
