import { describe, expect, it } from "vitest";
import { ApiError, errorMessage } from "./api";
import { expiryStateOf, fmtMinutes, fromLocalInput, humanize, toLocalInput } from "./format";

describe("format helpers", () => {
  it("humanizes enum values", () => {
    expect(humanize("IN_TRANSIT")).toBe("In transit");
    expect(humanize(null)).toBe("—");
  });

  it("formats minutes", () => {
    expect(fmtMinutes(45)).toBe("45m");
    expect(fmtMinutes(135)).toBe("2h 15m");
    expect(fmtMinutes(undefined)).toBe("—");
  });

  it("round-trips datetime-local values", () => {
    const iso = "2026-10-20T03:30:00.000Z";
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
    expect(fromLocalInput("")).toBeNull();
  });
});

describe("errorMessage", () => {
  it("includes validation details from the API", () => {
    const e = new ApiError(400, "Validation failed", [{ path: "weightKg", message: "Too small" }]);
    expect(errorMessage(e)).toBe("Validation failed — weightKg: Too small");
  });
  it("includes exclusion reasons", () => {
    expect(errorMessage(new ApiError(422, "No vehicle", [{ label: "MH01", reason: "PUC expired" }]))).toContain("MH01: PUC expired");
  });
});

describe("expiryStateOf", () => {
  const now = Date.parse("2026-11-12T00:00:00Z");
  it("matches the backend rule", () => {
    expect(expiryStateOf(null, 30, now)).toBe("NO_EXPIRY");
    expect(expiryStateOf("2026-11-11T00:00:00Z", 30, now)).toBe("EXPIRED");
    expect(expiryStateOf("2026-12-12T00:00:00Z", 30, now)).toBe("EXPIRING_SOON");
    expect(expiryStateOf("2026-12-13T00:00:00Z", 30, now)).toBe("VALID");
  });
});
