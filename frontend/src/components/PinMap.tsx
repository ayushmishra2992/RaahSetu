"use client";

/**
 * Single-pin Leaflet map for the location picker: shows the chosen point,
 * lets the user drag the pin or click the map to place it. Loaded only in the
 * browser (next/dynamic, ssr:false) because Leaflet needs `window`.
 * Same tile settings and OSM attribution rules as LeafletMap.
 */
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";
import type { TileConfig } from "@/lib/map";
import { INDIA_CENTER } from "@/lib/places";

const PIN_HTML =
  '<svg width="30" height="40" viewBox="0 0 30 40" aria-hidden="true"><path d="M15 39s13-13.2 13-23.5C28 7.5 22.2 2 15 2S2 7.5 2 15.5C2 25.8 15 39 15 39z" fill="#138075" stroke="#fff" stroke-width="2.5"/><circle cx="15" cy="15.5" r="5" fill="#fff"/></svg>';

const pinIcon = () => L.divIcon({ className: "rs-map-pin", html: PIN_HTML, iconSize: [30, 40], iconAnchor: [15, 39] });

export default function PinMap({
  lat,
  lng,
  onPick,
  height,
  tiles,
  onTilesFailed,
  label,
}: {
  lat: number | null;
  lng: number | null;
  onPick: (lat: number, lng: number, how: "drag" | "click") => void;
  height: number;
  tiles: TileConfig & { url: string };
  onTilesFailed: () => void;
  label: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const pickRef = useRef(onPick);
  const failedRef = useRef(onTilesFailed);
  useEffect(() => {
    pickRef.current = onPick;
    failedRef.current = onTilesFailed;
  }, [onPick, onTilesFailed]);

  // Create the map once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const map = L.map(el, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>');
    map.setView([INDIA_CENTER.lat, INDIA_CENTER.lng], INDIA_CENTER.zoom);
    map.on("focus", () => map.scrollWheelZoom.enable());
    map.on("blur mouseout", () => map.scrollWheelZoom.disable());
    map.on("click", (e: L.LeafletMouseEvent) => {
      map.scrollWheelZoom.enable();
      pickRef.current(e.latlng.lat, e.latlng.lng, "click");
    });

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
    const timer = window.setTimeout(fail, 12_000);
    mapRef.current = map;
    return () => {
      window.clearTimeout(timer);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [tiles.url, tiles.attribution, tiles.maxZoom]);

  // Keep the pin in sync with the value; recentre when it moves out of view.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (lat === null || lng === null) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    const at = L.latLng(lat, lng);
    if (!markerRef.current) {
      const marker = L.marker(at, { draggable: true, autoPan: true, icon: pinIcon(), title: "Drag to adjust the location", alt: "Selected location pin", keyboard: true });
      marker.on("dragend", () => {
        const p = marker.getLatLng();
        pickRef.current(p.lat, p.lng, "drag");
      });
      marker.addTo(map);
      markerRef.current = marker;
      map.setView(at, Math.max(map.getZoom(), 16));
    } else {
      markerRef.current.setLatLng(at);
      if (!map.getBounds().pad(-0.1).contains(at)) map.setView(at, Math.max(map.getZoom(), 15));
    }
  }, [lat, lng]);

  return (
    <div
      ref={containerRef}
      style={{ height }}
      className="relative z-0 w-full cursor-crosshair overflow-hidden rounded-md border border-line bg-[#f8fbfb]"
      role="region"
      aria-label={label}
    />
  );
}
