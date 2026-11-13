/**
 * Location search proxy: provider adapters (with a fake fetch — no network)
 * and the /api/places routes (with a fake signed-in user).
 */
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { errorHandler } from "../../src/middleware/error";
import { createPlacesRouter } from "../../src/modules/places/places.routes";
import { PlacesProviderError, type PlacesProvider } from "../../src/modules/places/places.types";
import { geoapifyProvider, locationIqProvider, normaliseGeoapify, normaliseLocationIq, providerFromSettings, withFallback, type FetchLike } from "../../src/modules/places/providers";

const KEY = "test-key-should-never-leak";

function fakeFetch(status: number, body: unknown, seen: string[] = []): FetchLike {
  return async (url) => {
    seen.push(url);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
}

const LOCATIONIQ_BODY = [
  {
    place_id: "321",
    lat: "19.1136",
    lon: "72.8697",
    display_name: "Andheri East Logistics Park, Marol, Andheri East, Mumbai, Maharashtra, 400059, India",
    display_place: "Andheri East Logistics Park",
    display_address: "Marol, Andheri East, Mumbai, Maharashtra, 400059, India",
    address: { name: "Andheri East Logistics Park", city: "Mumbai", state: "Maharashtra", postcode: "400059", country: "India" },
  },
  { place_id: "bad", lat: "not-a-number", lon: "72", display_name: "Broken" },
];

const GEOAPIFY_BODY = {
  results: [
    {
      place_id: "51abc",
      name: "Bhiwandi Warehouse Hub",
      formatted: "Bhiwandi Warehouse Hub, Bhiwandi, Thane, Maharashtra 421302, India",
      address_line1: "Bhiwandi Warehouse Hub",
      city: "Bhiwandi",
      state: "Maharashtra",
      postcode: "421302",
      country: "India",
      lat: 19.2967,
      lon: 73.0631,
    },
    { place_id: "x", formatted: "Out of range", lat: 120, lon: 10 },
  ],
};

describe("provider adapters", () => {
  it("normalises LocationIQ results and drops invalid coordinates", () => {
    const r = normaliseLocationIq(LOCATIONIQ_BODY);
    expect(r).toEqual([
      {
        providerPlaceId: "321",
        name: "Andheri East Logistics Park",
        address: "Andheri East Logistics Park, Marol, Andheri East, Mumbai, Maharashtra, 400059, India",
        city: "Mumbai",
        state: "Maharashtra",
        postalCode: "400059",
        country: "India",
        lat: 19.1136,
        lng: 72.8697,
      },
    ]);
  });

  it("normalises Geoapify results and drops invalid coordinates", () => {
    const r = normaliseGeoapify(GEOAPIFY_BODY);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ providerPlaceId: "51abc", name: "Bhiwandi Warehouse Hub", city: "Bhiwandi", state: "Maharashtra", postalCode: "421302", lat: 19.2967, lng: 73.0631 });
  });

  it("rejects unexpected response shapes", () => {
    expect(() => normaliseLocationIq({ error: "x" })).toThrow(PlacesProviderError);
    expect(() => normaliseGeoapify([])).toThrow(PlacesProviderError);
  });

  it("LocationIQ: sends the country filter and treats 404 as no results", async () => {
    const seen: string[] = [];
    const p = locationIqProvider(KEY, fakeFetch(404, { error: "Unable to geocode" }, seen));
    expect((await p.autocomplete("zzz", { country: "in", limit: 6 })).results).toEqual([]);
    const url = new URL(seen[0]);
    expect(url.host).toBe("api.locationiq.com");
    expect(url.searchParams.get("countrycodes")).toBe("in");
    expect(url.searchParams.get("q")).toBe("zzz");
  });

  it("Geoapify: sends the country filter", async () => {
    const seen: string[] = [];
    const p = geoapifyProvider(KEY, fakeFetch(200, GEOAPIFY_BODY, seen));
    const r = await p.autocomplete("bhiwandi", { country: "in", limit: 6 });
    expect(r.results).toHaveLength(1);
    expect(r.provider).toBe("geoapify");
    expect(r.attribution.map((a) => a.text)).toEqual(["Powered by Geoapify", "© OpenStreetMap contributors"]);
    expect(new URL(seen[0]).searchParams.get("filter")).toBe("countrycode:in");
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [429, "rate_limited"],
    [500, "unavailable"],
  ])("maps upstream HTTP %i to %s without exposing the key", async (status, reason) => {
    const p = locationIqProvider(KEY, fakeFetch(status, { error: "x" }));
    const err = await p.autocomplete("mumbai", { country: "in", limit: 6 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlacesProviderError);
    expect((err as PlacesProviderError).reason).toBe(reason);
    expect(String((err as Error).message)).not.toContain(KEY);
  });

  it("maps network failures to unavailable", async () => {
    const p = geoapifyProvider(KEY, async () => {
      throw new Error(`connect failed for https://api.geoapify.com/?apiKey=${KEY}`);
    });
    const err = (await p.autocomplete("mumbai", { country: "in", limit: 6 }).catch((e: unknown) => e)) as PlacesProviderError;
    expect(err.reason).toBe("unavailable");
    expect(err.message).not.toContain(KEY);
  });

  it("selects a provider only when both setting and key are present", () => {
    expect(providerFromSettings("none", KEY)).toEqual({ provider: null, disabledReason: "not_configured" });
    expect(providerFromSettings("locationiq", "  ")).toEqual({ provider: null, disabledReason: "missing_key" });
    expect(providerFromSettings("geoapify", KEY).provider?.id).toBe("geoapify");
  });

  it("configures a fallback only when it has its own key and differs from the primary", () => {
    expect(providerFromSettings("locationiq", KEY, undefined, "geoapify", "fb-key").provider?.fallbackId).toBe("geoapify");
    expect(providerFromSettings("locationiq", KEY, undefined, "geoapify", "").provider?.fallbackId).toBeUndefined();
    expect(providerFromSettings("locationiq", KEY, undefined, "locationiq", "fb-key").provider?.fallbackId).toBeUndefined();
    // Primary key missing but fallback configured: the fallback serves alone.
    expect(providerFromSettings("locationiq", "", undefined, "geoapify", "fb-key").provider?.id).toBe("geoapify");
  });

  it("falls back on provider failures and credits whoever answered", async () => {
    const logs: string[] = [];
    const primary = locationIqProvider(KEY, fakeFetch(429, { error: "Rate Limited Day" }));
    const fallback = geoapifyProvider("fb-key", fakeFetch(200, GEOAPIFY_BODY));
    const r = await withFallback(primary, fallback, (m) => logs.push(m)).autocomplete("bhiwandi", { country: "in", limit: 6 });
    expect(r.provider).toBe("geoapify");
    expect(r.attribution[0].text).toBe("Powered by Geoapify");
    expect(r.results[0].name).toBe("Bhiwandi Warehouse Hub");
    expect(logs).toEqual(["[places] locationiq rate_limited HTTP 429; trying geoapify"]);
    expect(logs.join(" ")).not.toContain(KEY);
  });

  it("does not fall back when the primary simply finds nothing", async () => {
    const seen: string[] = [];
    const primary = locationIqProvider(KEY, fakeFetch(404, { error: "Unable to geocode" }));
    const fallback = geoapifyProvider("fb-key", fakeFetch(200, GEOAPIFY_BODY, seen));
    const r = await withFallback(primary, fallback, () => {}).autocomplete("zzz", { country: "in", limit: 6 });
    expect(r).toMatchObject({ provider: "locationiq", results: [] });
    expect(seen).toHaveLength(0);
  });

  it("reports the fallback's error when both providers fail", async () => {
    const primary = locationIqProvider(KEY, fakeFetch(500, {}));
    const fallback = geoapifyProvider("fb-key", fakeFetch(401, {}));
    const err = (await withFallback(primary, fallback, () => {}).autocomplete("x y z", { country: "in", limit: 6 }).catch((e: unknown) => e)) as PlacesProviderError;
    expect(err.reason).toBe("auth");
  });
});

describe("/api/places routes", () => {
  function appWith(provider: PlacesProvider | null, role = "DISPATCHER", limit = 100) {
    const app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.auth = { userId: 1, companyId: 7, role: role as never, email: "u@example.test", driverId: null };
      next();
    });
    app.use("/api/places", createPlacesRouter({ provider, disabledReason: provider ? null : "not_configured" }, limit));
    app.use(errorHandler);
    return app;
  }

  const fake: PlacesProvider = {
    id: "fake",
    attribution: [{ text: "Fake data", url: "https://example.test/" }],
    async autocomplete(q) {
      if (q === "boom") throw new PlacesProviderError("rate_limited", 429);
      return { provider: "fake", attribution: this.attribution, results: normaliseLocationIq(LOCATIONIQ_BODY) };
    },
  };

  it("reports disabled search without a provider", async () => {
    const res = await request(appWith(null)).get("/api/places/status");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enabled: false, provider: null, reason: "not_configured" });
    const search = await request(appWith(null)).get("/api/places/autocomplete?q=mumbai");
    expect(search.status).toBe(503);
    expect(search.body.error.code).toBe("PLACES_DISABLED");
  });

  it("names the fallback in the response when it answered", async () => {
    const primary: PlacesProvider = { id: "p", attribution: [], async autocomplete() { throw new PlacesProviderError("timeout"); } };
    const app = appWith(withFallback(primary, fake, () => {}));
    const status = await request(app).get("/api/places/status");
    expect(status.body).toMatchObject({ enabled: true, provider: "p", fallback: "fake" });
    const res = await request(app).get("/api/places/autocomplete?q=andheri");
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe("fake");
    expect(res.body.attribution).toEqual([{ text: "Fake data", url: "https://example.test/" }]);
  });

  it("returns normalised suggestions with attribution", async () => {
    const res = await request(appWith(fake)).get("/api/places/autocomplete?q=andheri");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.provider).toBe("fake");
    expect(res.body.attribution).toEqual([{ text: "Fake data", url: "https://example.test/" }]);
    expect(res.body.results[0]).toMatchObject({ name: "Andheri East Logistics Park", postalCode: "400059" });
  });

  it("validates the query length", async () => {
    const res = await request(appWith(fake)).get("/api/places/autocomplete?q=ab");
    expect(res.status).toBe(400);
  });

  it("requires locations:write to search but only locations:read for status", async () => {
    expect((await request(appWith(fake, "EMPLOYEE")).get("/api/places/autocomplete?q=andheri")).status).toBe(403);
    expect((await request(appWith(fake, "DRIVER")).get("/api/places/status")).status).toBe(200);
  });

  it("turns provider rate limits into a friendly 503", async () => {
    const res = await request(appWith(fake)).get("/api/places/autocomplete?q=boom");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("PLACES_RATE_LIMITED");
  });

  it("rate-limits searches per company", async () => {
    const app = appWith(fake, "DISPATCHER", 2);
    expect((await request(app).get("/api/places/autocomplete?q=andheri")).status).toBe(200);
    expect((await request(app).get("/api/places/autocomplete?q=andheri")).status).toBe(200);
    const third = await request(app).get("/api/places/autocomplete?q=andheri");
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("PLACES_RATE_LIMITED");
  });
});

describe("reverse geocoding (LocationIQ /v1/reverse)", () => {
  const DELHI_REVERSE = {
    place_id: "777",
    lat: "28.6318",
    lon: "77.2172",
    display_name: "Outer Circle, Connaught Place, Chanakya Puri Tehsil, New Delhi, Delhi, 110001, India",
    address: { road: "Outer Circle", suburb: "Connaught Place", city: "New Delhi", postcode: "110001", country: "India", country_code: "in" },
  };

  it("normalises the address, fills Delhi as the state and reports the distance from the pin", async () => {
    const seen: string[] = [];
    const p = locationIqProvider(KEY, fakeFetch(200, DELHI_REVERSE, seen));
    const r = await p.reverse!(28.6315, 77.2167, {});
    expect(r.provider).toBe("locationiq");
    expect(r.place).toMatchObject({ name: "Outer Circle", address: DELHI_REVERSE.display_name, city: "New Delhi", state: "Delhi", postalCode: "110001", lat: 28.6318, lng: 77.2172 });
    expect(r.distanceM).toBeGreaterThan(50);
    expect(r.distanceM).toBeLessThan(70);
    const url = new URL(seen[0]);
    expect(url.pathname).toBe("/v1/reverse");
    expect(url.searchParams.get("lat")).toBe("28.6315");
    expect(url.searchParams.get("lon")).toBe("77.2167");
  });

  it("treats 404 as no address found", async () => {
    const r = await locationIqProvider(KEY, fakeFetch(404, { error: "Unable to geocode" })).reverse!(0, 0, {});
    expect(r).toMatchObject({ place: null, distanceM: null });
  });

  it("maps provider errors without exposing the key", async () => {
    const err = (await locationIqProvider(KEY, fakeFetch(429, {})).reverse!(19, 72, {}).catch((e: unknown) => e)) as PlacesProviderError;
    expect(err.reason).toBe("rate_limited");
    expect(err.message).not.toContain(KEY);
  });

  it("is exposed through the fallback wrapper using the primary only", async () => {
    const seenFallback: string[] = [];
    const wrapped = withFallback(locationIqProvider(KEY, fakeFetch(200, DELHI_REVERSE)), geoapifyProvider("fb", fakeFetch(200, GEOAPIFY_BODY, seenFallback)), () => {});
    expect((await wrapped.reverse!(28.6315, 77.2167, {})).place?.state).toBe("Delhi");
    expect(seenFallback).toHaveLength(0);
  });
});

describe("Indian rules applied to search results", () => {
  it("LocationIQ: Delhi without a state, a ward-only PIN result and a state name as city", () => {
    const r = normaliseLocationIq([
      { place_id: "1", class: "place", type: "suburb", lat: "28.63", lon: "77.21", display_name: "Connaught Place, Chanakya Puri Tehsil, Delhi, 110001, India", display_place: "Connaught Place", address: { name: "Connaught Place", suburb: "Chanakya Puri Tehsil", city: "Delhi", postcode: "110001", country: "India", country_code: "in" } },
      { place_id: "2", class: "place", type: "postcode", lat: "19.11", lon: "72.92", display_name: "400059, S Ward, Mumbai Suburban District, Maharashtra, 400059, India", display_place: "400059", address: { suburb: "S Ward", county: "Mumbai Suburban District", state: "Maharashtra", postcode: "400059", town: "S Ward", country_code: "in" } },
      { place_id: "3", class: "place", type: "town", lat: "22.98", lon: "88.54", display_name: "Haringhata, West Bengal, Haringhata, West Bengal, 741249, India", display_place: "Haringhata", address: { city: "West Bengal", county: "Haringhata", state: "West Bengal", postcode: "741249", country_code: "in" } },
    ]);
    expect(r.map((x) => [x.city, x.state, x.postalCode])).toEqual([
      ["Delhi", "Delhi", "110001"],
      ["Mumbai", "Maharashtra", "400059"],
      ["Haringhata", "West Bengal", "741249"],
    ]);
    // The provider's full address is preserved unchanged.
    expect(r[1].address).toBe("400059, S Ward, Mumbai Suburban District, Maharashtra, 400059, India");
  });

  it("Geoapify: same rules", () => {
    const r = normaliseGeoapify({ results: [{ place_id: "g", result_type: "suburb", name: "Connaught Place", formatted: "Connaught Place, New Delhi, Delhi 110001, India", city: "New Delhi", postcode: "110001", country: "India", country_code: "in", lat: 28.63, lon: 77.21 }] });
    expect(r[0]).toMatchObject({ city: "New Delhi", state: "Delhi", postalCode: "110001" });
  });

  it("non-Indian results keep the provider's own fields", () => {
    const r = normaliseLocationIq([{ place_id: "9", lat: "51.5", lon: "-0.12", display_name: "Westminster, London, England, SW1A 0AA, United Kingdom", display_place: "Westminster", address: { city: "London", state: "England", postcode: "SW1A 0AA", country_code: "gb" } }]);
    expect(r[0]).toMatchObject({ city: "London", state: "England", postalCode: "SW1A 0AA" });
  });
});

describe("/api/places/reverse route", () => {
  function app2(provider: PlacesProvider | null, role = "DISPATCHER", limit = 100) {
    const app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.auth = { userId: 1, companyId: 9, role: role as never, email: "u@example.test", driverId: null };
      next();
    });
    app.use("/api/places", createPlacesRouter({ provider, disabledReason: provider ? null : "not_configured" }, limit));
    app.use(errorHandler);
    return app;
  }
  const withReverse: PlacesProvider = {
    id: "fake",
    attribution: [{ text: "Fake data", url: "https://example.test/" }],
    async autocomplete() {
      return { provider: "fake", attribution: [], results: [] };
    },
    async reverse(lat, lng) {
      return {
        provider: "fake",
        attribution: [{ text: "Fake data", url: "https://example.test/" }],
        place: { providerPlaceId: "r1", name: "Gate 2", address: "Gate 2, Bhiwandi, Maharashtra, 421302, India", city: "Bhiwandi", state: "Maharashtra", postalCode: "421302", country: "India", lat: lat + 0.0003, lng },
        distanceM: 33,
      };
    },
  };
  const searchOnly: PlacesProvider = {
    id: "plain",
    attribution: [],
    async autocomplete() {
      return { provider: "plain", attribution: [], results: [] };
    },
  };

  it("returns the address, distance and attribution", async () => {
    const res = await request(app2(withReverse)).get("/api/places/reverse?lat=19.28&lng=73.05");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toMatchObject({ provider: "fake", distanceM: 33, place: { city: "Bhiwandi", postalCode: "421302" } });
  });

  it("reports reverse support in the status", async () => {
    expect((await request(app2(withReverse)).get("/api/places/status")).body.reverse).toBe(true);
    expect((await request(app2(searchOnly)).get("/api/places/status")).body.reverse).toBe(false);
    expect((await request(app2(null)).get("/api/places/status")).body.reverse).toBe(false);
  });

  it("validates coordinates, permissions and configuration", async () => {
    expect((await request(app2(withReverse)).get("/api/places/reverse?lat=95&lng=73")).status).toBe(400);
    expect((await request(app2(withReverse)).get("/api/places/reverse?lat=19")).status).toBe(400);
    expect((await request(app2(withReverse, "EMPLOYEE")).get("/api/places/reverse?lat=19&lng=73")).status).toBe(403);
    expect((await request(app2(null)).get("/api/places/reverse?lat=19&lng=73")).body.error.code).toBe("PLACES_DISABLED");
    expect((await request(app2(searchOnly)).get("/api/places/reverse?lat=19&lng=73")).status).toBe(501);
  });

  it("shares the per-company limit with searches", async () => {
    const app = app2(withReverse, "DISPATCHER", 2);
    expect((await request(app).get("/api/places/autocomplete?q=bhiwandi")).status).toBe(200);
    expect((await request(app).get("/api/places/reverse?lat=19&lng=73")).status).toBe(200);
    expect((await request(app).get("/api/places/reverse?lat=19&lng=73")).status).toBe(429);
  });
});
