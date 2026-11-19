import { z } from "zod";
import { prisma } from "../../config/prisma";
import { DEFAULT_COST_MODEL, DEFAULT_WEIGHTS } from "../../optimizer/costModel";
import type { CostModel, Weights } from "../../optimizer/types";

const perFuel = (defaults: Record<string, number>) =>
  z
    .object({
      DIESEL: z.number().nonnegative().default(defaults.DIESEL),
      PETROL: z.number().nonnegative().default(defaults.PETROL),
      CNG: z.number().nonnegative().default(defaults.CNG),
      ELECTRIC: z.number().nonnegative().default(defaults.ELECTRIC),
    })
    .default(defaults as never);

export const WeightsSchema = z.object({
  time: z.number().nonnegative().default(DEFAULT_WEIGHTS.time),
  distance: z.number().nonnegative().default(DEFAULT_WEIGHTS.distance),
  cost: z.number().nonnegative().default(DEFAULT_WEIGHTS.cost),
  emissions: z.number().nonnegative().default(DEFAULT_WEIGHTS.emissions),
  lateness: z.number().nonnegative().default(DEFAULT_WEIGHTS.lateness),
  risk: z.number().nonnegative().default(DEFAULT_WEIGHTS.risk),
});

const VehicleDocType = z.enum(["RC", "INSURANCE", "PUC", "FITNESS", "PERMIT", "STATE_PERMIT", "FASTAG", "OTHER"]);
const DriverDocType = z.enum(["DRIVING_LICENSE", "DRIVER_PHOTO", "KYC_ID", "OTHER"]);

/**
 * Which documents a company requires, and how strictly dispatch enforces them.
 * Defaults keep RaahSetu's earlier behaviour (an expired RC/insurance/PUC/fitness/permit
 * or licence blocks dispatch; a missing or unverified one is only flagged) so existing
 * fleets are not suddenly blocked. Legal applicability differs by vehicle, goods and
 * state, so every rule here is editable by the company admin rather than hardcoded.
 */
export const ComplianceSettingsSchema = z.object({
  vehicleRequirements: z
    .array(
      z.object({
        type: VehicleDocType,
        exemptFuelTypes: z.array(z.enum(["DIESEL", "PETROL", "CNG", "ELECTRIC"])).default([]),
        exemptVehicleTypes: z.array(z.enum(["TRUCK", "MINI_TRUCK", "VAN", "PICKUP", "TRAILER", "TANKER"])).default([]),
      }),
    )
    .max(20)
    .default([
      { type: "RC", exemptFuelTypes: [], exemptVehicleTypes: [] },
      { type: "INSURANCE", exemptFuelTypes: [], exemptVehicleTypes: [] },
      // Battery-electric vehicles have no tailpipe emissions and do not carry a PUC.
      { type: "PUC", exemptFuelTypes: ["ELECTRIC"], exemptVehicleTypes: [] },
      { type: "FITNESS", exemptFuelTypes: [], exemptVehicleTypes: [] },
      { type: "PERMIT", exemptFuelTypes: [], exemptVehicleTypes: [] },
    ]),
  driverRequirements: z.array(DriverDocType).max(10).default(["DRIVING_LICENSE"]),
  /** Block dispatch when a required document is missing (or only rejected copies exist). */
  blockOnMissing: z.boolean().default(false),
  /** Block dispatch until a required document has been verified by an admin/manager. */
  blockOnUnverified: z.boolean().default(false),
  /**
   * Declared consignment value (₹) above which an E-Way Bill is expected. The general
   * GST rule is ₹50,000, but some states and goods differ: set null to stop checking.
   */
  ewayBillValueThreshold: z.number().nonnegative().nullable().default(50000),
  /** Block dispatch when an expected E-Way Bill is missing or expired (otherwise only flagged). */
  blockOnMissingShipmentDocs: z.boolean().default(false),
});

export type ComplianceSettings = z.infer<typeof ComplianceSettingsSchema>;

export const CompanySettingsSchema = z.object({
  fuelPricePerUnit: perFuel(DEFAULT_COST_MODEL.fuelPricePerUnit),
  emissionKgPerUnit: perFuel(DEFAULT_COST_MODEL.emissionKgPerUnit),
  loadPenaltyAtFullLoad: z.number().min(0).max(2).default(DEFAULT_COST_MODEL.loadPenaltyAtFullLoad),
  driverCostPerHour: z.number().nonnegative().default(DEFAULT_COST_MODEL.driverCostPerHour),
  defaultWeights: WeightsSchema.default(DEFAULT_WEIGHTS),
  documentExpiryAlertDays: z.number().int().min(1).max(365).default(30),
  currency: z.string().default("INR"),
  // prefault: parse {} through the inner schema so every nested default applies.
  compliance: ComplianceSettingsSchema.prefault({}),
});

export type CompanySettings = z.infer<typeof CompanySettingsSchema>;

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Deep-merge a partial settings update into the stored settings. Objects merge
 * key by key; arrays and scalars replace; `undefined` leaves a value untouched.
 * Keys a client does not send are therefore never reset to defaults.
 */
export function mergeSettings(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch === undefined ? base : patch;
  const out: Record<string, unknown> = isPlainObject(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || k === "__proto__" || k === "constructor" || k === "prototype") continue;
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? mergeSettings(out[k], v) : v;
  }
  return out;
}

/**
 * Apply a partial update to stored settings and validate the result as a whole.
 * Returns the complete, validated settings or the validation issues.
 */
export function applySettingsPatch(stored: unknown, patch: unknown) {
  return CompanySettingsSchema.safeParse(mergeSettings(parseSettings(stored), patch));
}

export function parseSettings(raw: unknown): CompanySettings {
  const r = CompanySettingsSchema.safeParse(raw ?? {});
  return r.success ? r.data : CompanySettingsSchema.parse({});
}

export async function getCompanySettings(companyId: number): Promise<CompanySettings> {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { settings: true } });
  return parseSettings(c?.settings);
}

export function costModelFrom(s: CompanySettings): CostModel {
  return {
    fuelPricePerUnit: s.fuelPricePerUnit,
    emissionKgPerUnit: s.emissionKgPerUnit,
    loadPenaltyAtFullLoad: s.loadPenaltyAtFullLoad,
    driverCostPerHour: s.driverCostPerHour,
  };
}

export function weightsFrom(s: CompanySettings, override?: Partial<Weights>): Weights {
  return { ...s.defaultWeights, ...(override ?? {}) };
}
