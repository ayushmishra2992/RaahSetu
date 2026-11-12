import { describe, expect, it } from "vitest";
import { coordSignature, dedupeLabels, isValidCoord, locationKind, OSM_ATTRIBUTION, OSM_TILE_URL, resolveTileConfig } from "./map";

describe("resolveTileConfig", () => {
  it("defaults to OpenStreetMap tiles with OSM attribution", () => {
    expect(resolveTileConfig(undefined, undefined)).toEqual({ url: OSM_TILE_URL, attribution: OSM_ATTRIBUTION, maxZoom: 19 });
    expect(resolveTileConfig("  ", "")).toMatchObject({ url: OSM_TILE_URL, attribution: OSM_ATTRIBUTION });
  });
  it("can disable tiles", () => {
    for (const v of ["none", "off", "FALSE", "disabled"]) expect(resolveTileConfig(v, undefined).url).toBeNull();
  });
  it("accepts a custom https template and attribution", () => {
    const c = resolveTileConfig("https://tiles.example.com/{z}/{x}/{y}.png", "© Example, © OpenStreetMap", "17");
    expect(c).toEqual({ url: "https://tiles.example.com/{z}/{x}/{y}.png", attribution: "© Example, © OpenStreetMap", maxZoom: 17 });
  });
  it("rejects insecure or malformed templates and never allows blank attribution", () => {
    expect(resolveTileConfig("http://tiles.example.com/{z}/{x}/{y}.png", "   ").url).toBe(OSM_TILE_URL);
    expect(resolveTileConfig("https://tiles.example.com/tile.png", undefined).url).toBe(OSM_TILE_URL);
    expect(resolveTileConfig(undefined, "   ").attribution).toBe(OSM_ATTRIBUTION);
    expect(resolveTileConfig(undefined, undefined, "99").maxZoom).toBe(19);
  });
});

describe("map helpers", () => {
  it("maps location types to marker kinds", () => {
    expect(["DEPOT", "WAREHOUSE", "CUSTOMER", "OTHER", "X"].map(locationKind)).toEqual(["depot", "warehouse", "customer", "other", "other"]);
  });
  it("labels a shared coordinate once but keeps vehicle labels", () => {
    const out = dedupeLabels([
      { lat: 19.1, lng: 72.9, label: "Depot", kind: "depot" as const },
      { lat: 19.1, lng: 72.9, label: "Depot", kind: "depot" as const },
      { lat: 19.1, lng: 72.9, label: "MH04", kind: "vehicle" as const },
    ]);
    expect(out.map((p) => p.label)).toEqual(["Depot", undefined, "MH04"]);
  });
  it("validates coordinates", () => {
    expect(isValidCoord({ lat: 19, lng: 72 })).toBe(true);
    expect(isValidCoord({ lat: Number.NaN, lng: 72 })).toBe(false);
    expect(isValidCoord({ lat: 91, lng: 0 })).toBe(false);
    expect(isValidCoord(null)).toBe(false);
  });
  it("builds a stable coordinate signature", () => {
    expect(coordSignature([{ lat: 19.123456789, lng: 72.1 }])).toBe("19.12346,72.10000");
  });
});
