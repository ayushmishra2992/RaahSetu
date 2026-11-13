/**
 * Indian address rules. Fixtures are the raw LocationIQ `address` objects
 * recorded on 2026-11-13 (Stage 1 investigation), so the rules are tested
 * against what the provider actually returns.
 */
import { describe, expect, it } from "vitest";
import { canonicalRegion, cityFromDistrict, extractIndianAddress, indianPin, INDIAN_STATES_AND_UTS, isAdministrativeUnit } from "../../src/modules/places/india";

describe("canonical states and union territories", () => {
  it("lists 28 states and 8 union territories", () => {
    expect(INDIAN_STATES_AND_UTS).toHaveLength(36);
  });

  it.each([
    ["maharashtra", "Maharashtra"],
    ["Orissa", "Odisha"],
    ["Uttaranchal", "Uttarakhand"],
    ["NCT of Delhi", "Delhi"],
    ["National Capital Territory of Delhi", "Delhi"],
    ["New Delhi", "Delhi"],
    ["Pondicherry", "Puducherry"],
    ["Jammu & Kashmir", "Jammu and Kashmir"],
    ["Andaman & Nicobar Islands", "Andaman and Nicobar Islands"],
    ["Daman and Diu", "Dadra and Nagar Haveli and Daman and Diu"],
    ["  tamil   nadu ", "Tamil Nadu"],
  ])("%s → %s", (input, expected) => {
    expect(canonicalRegion(input)).toBe(expected);
  });

  it("returns null for anything that is not a state or UT", () => {
    for (const v of ["Mumbai", "Gurgaon", "K/E Ward", "", null, undefined]) expect(canonicalRegion(v)).toBeNull();
  });
});

describe("administrative units are not cities", () => {
  it.each(["K/E Ward", "S Ward", "Ward 104 Kondapur", "Mumbai Zone 3", "Uran Subdistrict", "Chanakya Puri Tehsil", "Khed Taluka", "Serilingampalle mandal", "Pune District", "Bengaluru South City Corporation"])("%s", (v) => {
    expect(isAdministrativeUnit(v)).toBe(true);
  });

  it.each(["Mumbai", "Bhiwandi", "Bhamboli", "Navi Mumbai", "Wardha"])("%s is a settlement", (v) => {
    expect(isAdministrativeUnit(v)).toBe(false);
  });

  it("derives a city from a district name only as a last resort", () => {
    expect(cityFromDistrict("Mumbai Suburban District")).toBe("Mumbai");
    expect(cityFromDistrict("Mumbai City District")).toBe("Mumbai");
    expect(cityFromDistrict("Pune District")).toBe("Pune");
    expect(cityFromDistrict("Khed")).toBeNull();
    expect(cityFromDistrict(undefined)).toBeNull();
  });
});

describe("PIN codes", () => {
  it("accepts 6-digit Indian PINs and strips spaces", () => {
    expect(indianPin("400059")).toBe("400059");
    expect(indianPin("400 059")).toBe("400059");
  });
  it("rejects anything else", () => {
    for (const v of ["040005", "40005", "4000599", "ABC123", "", null, undefined]) expect(indianPin(v)).toBeNull();
  });
});

describe("extractIndianAddress (raw LocationIQ fixtures)", () => {
  it("Delhi search result without a state field", () => {
    expect(
      extractIndianAddress({
        displayName: "Connaught Place, Chanakya Puri Tehsil, Delhi, 110001, India",
        name: "Connaught Place",
        category: "place",
        type: "suburb",
        address: { name: "Connaught Place", suburb: "Chanakya Puri Tehsil", city: "Delhi", postcode: "110001", country: "India", country_code: "in" },
      }),
    ).toEqual({ city: "Delhi", state: "Delhi", postalCode: "110001" });
  });

  it("Delhi reverse result (New Delhi, no state)", () => {
    expect(
      extractIndianAddress({
        displayName: "Outer Circle, Connaught Place, Chanakya Puri Tehsil, New Delhi, Delhi, 110001, India",
        address: { road: "Outer Circle", suburb: "Connaught Place", city: "New Delhi", postcode: "110001", country: "India", country_code: "in" },
      }),
    ).toEqual({ city: "New Delhi", state: "Delhi", postalCode: "110001" });
  });

  it("Delhi with neither a state field nor Delhi in the address falls back to the city", () => {
    expect(extractIndianAddress({ displayName: "Somewhere, New Delhi, 110001, India", address: { city: "New Delhi", postcode: "110001" } }).state).toBe("Delhi");
  });

  it("NCR outside Delhi keeps its own state", () => {
    expect(
      extractIndianAddress({
        displayName: "Noida Sector 62, Vishwakarma Road, Sector 62, Noida, Dadri, Uttar Pradesh, 201309, India",
        name: "Noida Sector 62",
        category: "railway",
        type: "station",
        address: { road: "Vishwakarma Road", suburb: "Sector 62", city: "Noida", county: "Dadri", state: "Uttar Pradesh", postcode: "201309" },
      }),
    ).toEqual({ city: "Noida", state: "Uttar Pradesh", postalCode: "201309" });
    expect(
      extractIndianAddress({ displayName: "Manesar, Gurgaon, Haryana, India", name: "Manesar", category: "boundary", type: "administrative", address: { name: "Manesar", city: "Gurgaon", state: "Haryana" } }),
    ).toEqual({ city: "Gurgaon", state: "Haryana", postalCode: null });
  });

  it("Mumbai ward in suburb: city stays Mumbai", () => {
    expect(
      extractIndianAddress({
        displayName: "Andheri East, K/E Ward, Mumbai, Mumbai Suburban District, Maharashtra, 400069, India",
        name: "Andheri East",
        category: "place",
        type: "suburb",
        address: { suburb: "K/E Ward", city: "Mumbai", county: "Mumbai Suburban District", state: "Maharashtra", postcode: "400069" },
      }),
    ).toEqual({ city: "Mumbai", state: "Maharashtra", postalCode: "400069" });
  });

  it("PIN-code result whose only 'town' is a ward: city comes from the district", () => {
    expect(
      extractIndianAddress({
        displayName: "400059, S Ward, Mumbai Suburban District, Maharashtra, 400059, India",
        name: "400059",
        category: "place",
        type: "postcode",
        address: { suburb: "S Ward", county: "Mumbai Suburban District", state: "Maharashtra", postcode: "400059", town: "S Ward" },
      }),
    ).toEqual({ city: "Mumbai", state: "Maharashtra", postalCode: "400059" });
  });

  it("industrial area in a village keeps the village; a taluka is never the city", () => {
    expect(
      extractIndianAddress({
        displayName: "Tata toyo radiator midc Chakan, Sant Tukaram Maharaj Circle, Bhamboli, Khed, Pune District, Maharashtra, 410501, India",
        address: { company: "Tata toyo radiator midc Chakan", village: "Bhamboli", county: "Khed", state_district: "Pune District", state: "Maharashtra", postcode: "410501", city: "Bhamboli" },
      }),
    ).toEqual({ city: "Bhamboli", state: "Maharashtra", postalCode: "410501" });
    // No settlement at all: the taluka "Khed" is not used, and there is no district to fall back to.
    expect(
      extractIndianAddress({
        displayName: "Courtyard Marriott, Plot P-7 MIDC 1, Talegaon Chakan Road, Khed, Maharashtra, 412109, India",
        name: "Courtyard Marriott",
        category: "tourism",
        type: "hotel",
        address: { road: "Talegaon Chakan Road", county: "Khed", state: "Maharashtra", postcode: "412109" },
      }),
    ).toEqual({ city: null, state: "Maharashtra", postalCode: "412109" });
  });

  it("a state name in the city field is rejected in favour of the place's own name", () => {
    expect(
      extractIndianAddress({
        displayName: "Haringhata, Kanchrapara - Nagarukhra - Bongaon Highway, West Bengal, Haringhata, West Bengal, 741249, India",
        name: "Haringhata",
        category: "place",
        type: "town",
        address: { city: "West Bengal", county: "Haringhata", state: "West Bengal", postcode: "741249" },
      }),
    ).toEqual({ city: "Haringhata", state: "West Bengal", postalCode: "741249" });
  });

  it("a rural village result without a city", () => {
    expect(
      extractIndianAddress({ displayName: "Amethi, Uttar Pradesh, 227405, India", address: { village: "Amethi", state: "Uttar Pradesh", postcode: "227405" } }),
    ).toEqual({ city: "Amethi", state: "Uttar Pradesh", postalCode: "227405" });
  });

  it("a reverse result in a Mumbai zone uses the city, not the zone", () => {
    expect(
      extractIndianAddress({
        displayName: "Navpada, Andheri East, K/E Ward, Mumbai Zone 3, Mumbai, Mumbai Suburban District, Maharashtra, 400059, India",
        address: { suburb: "Andheri East", city_district: "Mumbai Zone 3", city: "Mumbai", state_district: "Mumbai Suburban District", state: "Maharashtra", postcode: "400059" },
      }),
    ).toEqual({ city: "Mumbai", state: "Maharashtra", postalCode: "400059" });
  });

  it("an invalid PIN is dropped rather than stored", () => {
    expect(extractIndianAddress({ displayName: "X, Maharashtra, India", address: { city: "Pune", state: "Maharashtra", postcode: "41100" } }).postalCode).toBeNull();
  });
});
