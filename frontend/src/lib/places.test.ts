import { describe, expect, it } from "vitest";
import { broadenOptions, coordProblem, findDuplicates, fmtDistanceM, localityLine, locationFieldsFromPlace, metresBetween, normaliseQuery, pinKey, round6, SAME_SPOT_M, savedMatches, SearchCache } from "./places";
import type { Location } from "./types";

describe("places helpers", () => {
  it("validates coordinates", () => {
    expect(coordProblem(null, 72)).toMatch(/Choose a place/);
    expect(coordProblem(91, 72)).toMatch(/Latitude/);
    expect(coordProblem(19, -181)).toMatch(/Longitude/);
    expect(coordProblem(Number.NaN, 72)).toMatch(/Choose a place/);
    expect(coordProblem(19.07, 72.87)).toBeNull();
  });

  it("rounds pins to 6 decimals", () => {
    expect(round6(19.123456789)).toBe(19.123457);
    expect(locationFieldsFromPlace({ lat: 19.1234567, lng: 72.9876543, source: "MANUAL" })).toMatchObject({ lat: 19.123457, lng: 72.987654 });
    expect(locationFieldsFromPlace({ lat: null, lng: 72, source: "MANUAL" })).toBeNull();
  });

  it("builds the locality line from whatever parts exist", () => {
    expect(localityLine({ city: "Mumbai", state: "Maharashtra", postalCode: "400059" })).toBe("Mumbai, Maharashtra 400059");
    expect(localityLine({ city: null, state: "Maharashtra", postalCode: null })).toBe("Maharashtra");
    expect(localityLine({ city: null, state: null, postalCode: null })).toBe("");
  });

  it("measures pin adjustments", () => {
    // 0.001° of latitude ≈ 111 m.
    expect(metresBetween({ lat: 19, lng: 72.8 }, { lat: 19.001, lng: 72.8 })).toBeCloseTo(111.2, 0);
    expect(fmtDistanceM(111.2)).toBe("111 m");
    expect(fmtDistanceM(2500)).toBe("2.5 km");
    expect(fmtDistanceM(25_000)).toBe("25 km");
  });
});

describe("locationFieldsFromPlace", () => {
  const found = { providerPlaceId: "p-1", name: "Hub", address: "Hub, Bhiwandi, Maharashtra 421302, India", city: "Bhiwandi", state: "Maharashtra", postalCode: "421302", country: "India", lat: 19.28, lng: 73.04 };

  it("sends search details with SEARCH or PIN_ADJUSTED", () => {
    expect(locationFieldsFromPlace({ lat: 19.28, lng: 73.04, source: "SEARCH", place: { ...found, provider: "locationiq" } })).toEqual({
      lat: 19.28, lng: 73.04, coordsSource: "SEARCH", city: "Bhiwandi", state: "Maharashtra", postalCode: "421302", country: "India", placeProvider: "locationiq", providerPlaceId: "p-1",
    });
    expect(locationFieldsFromPlace({ lat: 19.29, lng: 73.05, source: "PIN_ADJUSTED", place: { ...found, provider: "geoapify" } })).toMatchObject({ coordsSource: "PIN_ADJUSTED", placeProvider: "geoapify", lat: 19.29 });
  });

  it("drops an unknown provider name rather than sending it", () => {
    expect(locationFieldsFromPlace({ lat: 19.28, lng: 73.04, source: "SEARCH", place: { ...found, provider: "test-provider" } })?.placeProvider).toBeNull();
  });

  it("leaves provenance untouched for an unchanged saved pin", () => {
    expect(locationFieldsFromPlace({ lat: 19.1, lng: 72.9, source: "EXISTING", place: null }, { isNew: false })).toEqual({ lat: 19.1, lng: 72.9 });
  });

  it("moving a saved search location's pin keeps its saved details", () => {
    expect(locationFieldsFromPlace({ lat: 19.1, lng: 72.9, source: "PIN_ADJUSTED", place: { ...found, provider: "saved" } }, { isNew: false })).toEqual({ lat: 19.1, lng: 72.9, coordsSource: "PIN_ADJUSTED" });
  });

  it("manual pins clear details on new locations and keep them on edits", () => {
    expect(locationFieldsFromPlace({ lat: 19.1, lng: 72.9, source: "MANUAL", place: null })).toMatchObject({ coordsSource: "MANUAL", city: null, placeProvider: null, providerPlaceId: null });
    expect(locationFieldsFromPlace({ lat: 19.1, lng: 72.9, source: "MANUAL", place: null }, { isNew: false })).toEqual({ lat: 19.1, lng: 72.9, coordsSource: "MANUAL" });
  });
});

describe("query normalisation", () => {
  it.each([
    ["  Bhiwandi   warehouse  ", "Bhiwandi warehouse"],
    ["Andheri East,.", "Andheri East"],
    ["Thane station?!", "Thane station"],
    ["-- Vashi APMC --", "Vashi APMC"],
    ["Plot 7/A, MIDC", "Plot 7/A, MIDC"],
    [",,,", ""],
  ])("%j → %j", (a, b) => expect(normaliseQuery(a)).toBe(b));
});

describe("SearchCache", () => {
  const res = (n: number) => ({ provider: "locationiq", attribution: [], results: Array.from({ length: n }, (_, i) => ({ providerPlaceId: String(i), name: "x", address: "x", city: null, state: null, postalCode: null, country: null, lat: 1, lng: 1 })) });

  it("returns cached results for the same query regardless of case, spaces or trailing punctuation", () => {
    const c = new SearchCache();
    c.set("Bhiwandi", res(2));
    expect(c.get("bhiwandi")?.results).toHaveLength(2);
    expect(c.get("  BHIWANDI ,")?.results).toHaveLength(2);
    expect(c.get("bhiwand")).toBeUndefined();
  });

  it("recognises extensions of a query that found nothing", () => {
    const c = new SearchCache();
    c.set("zzzz nowhere", res(0));
    expect(c.extendsDeadEnd("zzzz nowheres")).toBe(true);
    expect(c.extendsDeadEnd("ZZZZ Nowhere else")).toBe(true);
    expect(c.extendsDeadEnd("zzzz nowhere")).toBe(false); // the same query is a cache hit, not an extension
    expect(c.extendsDeadEnd("zzzz now")).toBe(false); // shorter: may match more
    expect(c.extendsDeadEnd("other")).toBe(false);
  });

  it("never treats digit queries or very short dead ends as final", () => {
    const c = new SearchCache();
    c.set("40005", res(0)); // a partial PIN finds nothing although the full PIN does
    expect(c.extendsDeadEnd("400059")).toBe(false);
    c.set("abc", res(0)); // under 4 characters
    expect(c.extendsDeadEnd("abcd")).toBe(false);
    c.set("andheri e", res(0)); // last word under 3 characters
    expect(c.extendsDeadEnd("andheri east")).toBe(false);
  });

  it("does not record a dead end when results exist, and is bounded", () => {
    const c = new SearchCache(3);
    c.set("mumbai", res(3));
    expect(c.extendsDeadEnd("mumbai central")).toBe(false);
    c.set("a1", res(1));
    c.set("a2", res(1));
    c.set("a3", res(1));
    expect(c.size).toBe(3);
    expect(c.get("mumbai")).toBeUndefined(); // oldest evicted
  });
});

describe("broadenOptions", () => {
  it("drops generic business words first", () => {
    expect(broadenOptions("Amazon fulfillment center Bhiwandi")).toEqual(["Amazon Bhiwandi"]);
    expect(broadenOptions("XYZ Logistics Pvt Ltd warehouse Taloja")).toEqual(["XYZ Logistics Taloja"]);
  });

  it("otherwise offers the query without its last word, and the last word alone", () => {
    expect(broadenOptions("Andheri Eest")).toEqual(["Andheri", "Eest"]);
    expect(broadenOptions("Amazon Bhiwandi")).toEqual(["Amazon", "Bhiwandi"]);
  });

  it("offers nothing for a single word or options that are too short", () => {
    expect(broadenOptions("Bhiwandi")).toEqual([]);
    expect(broadenOptions("A B")).toEqual([]);
  });
});

const loc = (id: number, name: string, lat: number, lng: number, extra: Partial<Location> = {}): Location => ({ id, name, address: null, type: "CUSTOMER", lat, lng, roadNodeId: null, ...extra });

describe("savedMatches", () => {
  const all = [
    loc(1, "Bhiwandi Depot", 19.2967, 73.0631, { address: "Mankoli, Bhiwandi", postalCode: "421302" }),
    loc(2, "Vashi Warehouse", 19.0771, 72.9986, { city: "Navi Mumbai" }),
    loc(3, "Andheri Customer", 19.1136, 72.8697),
  ];

  it("matches every word against name, address, city and PIN", () => {
    expect(savedMatches("bhiwandi", all).map((l) => l.id)).toEqual([1]);
    expect(savedMatches("421302", all).map((l) => l.id)).toEqual([1]);
    expect(savedMatches("navi mumbai", all).map((l) => l.id)).toEqual([2]);
    expect(savedMatches("vashi depot", all)).toEqual([]);
  });

  it("needs at least 2 characters", () => {
    expect(savedMatches("b", all)).toEqual([]);
  });
});

describe("findDuplicates", () => {
  const all = [
    loc(1, "Andheri Customer", 19.1136, 72.8697, { placeProvider: "locationiq", providerPlaceId: "p-3" }),
    loc(2, "Customer Warehouse", 19.0771, 72.9986),
    loc(3, "Customer Warehouse", 28.6315, 77.2167), // same name, Delhi
  ];

  it("flags a pin at the same spot", () => {
    const d = findDuplicates({ name: "Cold store", lat: 19.1138, lng: 72.8698 }, all);
    expect(d.map((x) => [x.location.id, x.reasons])).toEqual([[1, ["very close"]]]);
    expect(d[0].distanceM).toBeLessThanOrEqual(SAME_SPOT_M);
  });

  it("flags the same name nearby but not the same name in another city", () => {
    const d = findDuplicates({ name: "customer  warehouse", lat: 19.0800, lng: 72.9986 }, all);
    expect(d.map((x) => x.location.id)).toEqual([2]);
    expect(d[0].reasons).toEqual(["same name nearby"]);
  });

  it("does not flag a legitimate location at different coordinates", () => {
    expect(findDuplicates({ name: "Andheri Customer", lat: 19.1236, lng: 72.8697 }, all)).toEqual([]); // ~1.1 km away
    expect(findDuplicates({ name: "New site", lat: 19.12, lng: 72.88 }, all)).toEqual([]);
  });

  it("flags the same provider place even when the pin was moved", () => {
    const d = findDuplicates({ name: "Other", lat: 19.2, lng: 72.9, placeProvider: "locationiq", providerPlaceId: "p-3" }, all);
    expect(d[0].reasons).toEqual(["same place"]);
  });

  it("ignores the location being edited", () => {
    expect(findDuplicates({ name: "Andheri Customer", lat: 19.1136, lng: 72.8697 }, all, 1)).toEqual([]);
  });
});

describe("pinKey", () => {
  it("groups positions within about a metre", () => {
    expect(pinKey(19.123451, 72.987651)).toBe(pinKey(19.123449, 72.987649));
    expect(pinKey(19.1234, 72.9876)).not.toBe(pinKey(19.1235, 72.9876));
  });
});
