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

export const CompanySettingsSchema = z.object({
  fuelPricePerUnit: perFuel(DEFAULT_COST_MODEL.fuelPricePerUnit),
  emissionKgPerUnit: perFuel(DEFAULT_COST_MODEL.emissionKgPerUnit),
  loadPenaltyAtFullLoad: z.number().min(0).max(2).default(DEFAULT_COST_MODEL.loadPenaltyAtFullLoad),
  driverCostPerHour: z.number().nonnegative().default(DEFAULT_COST_MODEL.driverCostPerHour),
  defaultWeights: WeightsSchema.default(DEFAULT_WEIGHTS),
  documentExpiryAlertDays: z.number().int().min(1).max(365).default(30),
  currency: z.string().default("INR"),
});

export type CompanySettings = z.infer<typeof CompanySettingsSchema>;

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
