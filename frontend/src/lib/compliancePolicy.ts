import type { CompliancePolicy } from "./types";

/** Same defaults as backend ComplianceSettingsSchema (used when the API omits the policy). */
export const DEFAULT_POLICY: CompliancePolicy = {
  vehicleRequirements: [
    { type: "RC", exemptFuelTypes: [], exemptVehicleTypes: [] },
    { type: "INSURANCE", exemptFuelTypes: [], exemptVehicleTypes: [] },
    { type: "PUC", exemptFuelTypes: ["ELECTRIC"], exemptVehicleTypes: [] },
    { type: "FITNESS", exemptFuelTypes: [], exemptVehicleTypes: [] },
    { type: "PERMIT", exemptFuelTypes: [], exemptVehicleTypes: [] },
  ],
  driverRequirements: ["DRIVING_LICENSE"],
  blockOnMissing: false,
  blockOnUnverified: false,
  ewayBillValueThreshold: 50000,
  blockOnMissingShipmentDocs: false,
};

export const POLICY_VEHICLE_DOC_TYPES = ["RC", "INSURANCE", "PUC", "FITNESS", "PERMIT", "STATE_PERMIT", "FASTAG"] as const;
export const POLICY_DRIVER_DOC_TYPES = ["DRIVING_LICENSE", "DRIVER_PHOTO", "KYC_ID"] as const;
export const POLICY_FUELS = ["DIESEL", "PETROL", "CNG", "ELECTRIC"] as const;
export const POLICY_VEHICLE_TYPES = ["TRUCK", "MINI_TRUCK", "VAN", "PICKUP", "TRAILER", "TANKER"] as const;

/** Add or remove a required vehicle document, keeping any exemptions already set for it. */
export function toggleVehicleRequirement(p: CompliancePolicy, type: string, required: boolean): CompliancePolicy {
  const has = p.vehicleRequirements.some((r) => r.type === type);
  if (required === has) return p;
  return {
    ...p,
    vehicleRequirements: required ? [...p.vehicleRequirements, { type, exemptFuelTypes: [], exemptVehicleTypes: [] }] : p.vehicleRequirements.filter((r) => r.type !== type),
  };
}

export function toggleExemption(p: CompliancePolicy, type: string, kind: "exemptFuelTypes" | "exemptVehicleTypes", value: string, on: boolean): CompliancePolicy {
  return {
    ...p,
    vehicleRequirements: p.vehicleRequirements.map((r) =>
      r.type !== type ? r : { ...r, [kind]: on ? [...new Set([...r[kind], value])] : r[kind].filter((v) => v !== value) },
    ),
  };
}

export function toggleDriverRequirement(p: CompliancePolicy, type: string, required: boolean): CompliancePolicy {
  const set = new Set(p.driverRequirements);
  if (required) set.add(type);
  else set.delete(type);
  return { ...p, driverRequirements: POLICY_DRIVER_DOC_TYPES.filter((t) => set.has(t)) };
}

/** Mirrors the backend limits; returns a message or null. */
export function policyProblem(p: CompliancePolicy): string | null {
  if (p.ewayBillValueThreshold !== null && (!Number.isFinite(p.ewayBillValueThreshold) || p.ewayBillValueThreshold < 0)) return "The E-Way Bill threshold must be a positive amount, or switch the check off.";
  for (const r of p.vehicleRequirements) {
    if (r.exemptFuelTypes.length === POLICY_FUELS.length || r.exemptVehicleTypes.length === POLICY_VEHICLE_TYPES.length) {
      return `${r.type} is exempt for every vehicle — untick "required" instead.`;
    }
  }
  if (p.vehicleRequirements.length > 20) return "Too many vehicle requirements.";
  return null;
}
