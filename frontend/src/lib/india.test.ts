import { describe, expect, it } from "vitest";
import { canonicalRegion, indianPin, INDIAN_STATES_AND_UTS, pinProblem } from "./india";

describe("states and union territories", () => {
  it("has 36 entries ending with the 8 union territories", () => {
    expect(INDIAN_STATES_AND_UTS).toHaveLength(36);
    expect(INDIAN_STATES_AND_UTS.slice(-8)).toContain("Delhi");
  });

  it.each([
    ["NCT of Delhi", "Delhi"],
    ["New Delhi", "Delhi"],
    ["orissa", "Odisha"],
    ["Pondicherry", "Puducherry"],
    ["Jammu & Kashmir", "Jammu and Kashmir"],
    ["uttaranchal", "Uttarakhand"],
  ])("%s → %s", (a, b) => expect(canonicalRegion(a)).toBe(b));

  it("is null for cities and wards", () => {
    expect(canonicalRegion("Mumbai")).toBeNull();
    expect(canonicalRegion("K/E Ward")).toBeNull();
    expect(canonicalRegion("")).toBeNull();
  });
});

describe("PIN codes", () => {
  it("accepts 6 digits not starting with 0, ignoring spaces", () => {
    expect(indianPin("400059")).toBe("400059");
    expect(indianPin("400 059")).toBe("400059");
    expect(indianPin("040005")).toBeNull();
    expect(indianPin("40005")).toBeNull();
  });

  it("explains invalid PINs and allows an empty field", () => {
    expect(pinProblem("")).toBeNull();
    expect(pinProblem("  ")).toBeNull();
    expect(pinProblem("4000")).toMatch(/6-digit/);
    expect(pinProblem("400059")).toBeNull();
  });
});
