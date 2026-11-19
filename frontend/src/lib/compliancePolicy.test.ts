import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, policyProblem, toggleDriverRequirement, toggleExemption, toggleVehicleRequirement } from "./compliancePolicy";

describe("compliance policy editing", () => {
  it("adds and removes vehicle requirements without touching others", () => {
    const withTag = toggleVehicleRequirement(DEFAULT_POLICY, "FASTAG", true);
    expect(withTag.vehicleRequirements.map((r) => r.type)).toEqual(["RC", "INSURANCE", "PUC", "FITNESS", "PERMIT", "FASTAG"]);
    const noPermit = toggleVehicleRequirement(withTag, "PERMIT", false);
    expect(noPermit.vehicleRequirements.map((r) => r.type)).toEqual(["RC", "INSURANCE", "PUC", "FITNESS", "FASTAG"]);
    expect(noPermit.vehicleRequirements.find((r) => r.type === "PUC")!.exemptFuelTypes).toEqual(["ELECTRIC"]); // exemptions kept
    expect(toggleVehicleRequirement(DEFAULT_POLICY, "RC", true)).toBe(DEFAULT_POLICY); // no-op
  });

  it("toggles exemptions without duplicates", () => {
    const a = toggleExemption(DEFAULT_POLICY, "PERMIT", "exemptVehicleTypes", "VAN", true);
    const b = toggleExemption(a, "PERMIT", "exemptVehicleTypes", "VAN", true);
    expect(b.vehicleRequirements.find((r) => r.type === "PERMIT")!.exemptVehicleTypes).toEqual(["VAN"]);
    const c = toggleExemption(b, "PERMIT", "exemptVehicleTypes", "VAN", false);
    expect(c.vehicleRequirements.find((r) => r.type === "PERMIT")!.exemptVehicleTypes).toEqual([]);
  });

  it("keeps driver requirements in a stable order", () => {
    const p = toggleDriverRequirement(toggleDriverRequirement(DEFAULT_POLICY, "KYC_ID", true), "DRIVER_PHOTO", true);
    expect(p.driverRequirements).toEqual(["DRIVING_LICENSE", "DRIVER_PHOTO", "KYC_ID"]);
    expect(toggleDriverRequirement(p, "DRIVING_LICENSE", false).driverRequirements).toEqual(["DRIVER_PHOTO", "KYC_ID"]);
  });

  it("explains invalid policies", () => {
    expect(policyProblem(DEFAULT_POLICY)).toBeNull();
    expect(policyProblem({ ...DEFAULT_POLICY, ewayBillValueThreshold: -1 })).toMatch(/E-Way Bill threshold/);
    expect(policyProblem({ ...DEFAULT_POLICY, ewayBillValueThreshold: null })).toBeNull();
    const allFuels = ["DIESEL", "PETROL", "CNG", "ELECTRIC"].reduce((p, f) => toggleExemption(p, "RC", "exemptFuelTypes", f, true), DEFAULT_POLICY);
    expect(policyProblem(allFuels)).toMatch(/RC is exempt for every vehicle/);
  });
});
