import type { CostModel, FuelKind, Weights } from "./types";

/**
 * Default GreenFleet assumptions. These are *estimates* for planning, not
 * measurements. Every company can override them in Settings.
 *
 * Emission factors (tank-to-wheel, kg CO2 per unit of energy):
 *  - Diesel 2.68 kg/L, Petrol 2.31 kg/L: widely used combustion factors
 *    (e.g. UK DESNZ/DEFRA conversion factors, IPCC 2006 defaults).
 *  - CNG 2.75 kg/kg: approximate stoichiometric CO2 from natural gas combustion.
 *  - Electric 0.71 kg/kWh: approximate Indian grid average (CEA CO2 Baseline
 *    Database). Verify the current CEA value before formal reporting.
 * Prices are placeholders in INR; set your actual prices in Settings.
 */
export const DEFAULT_COST_MODEL: CostModel = {
  fuelPricePerUnit: { DIESEL: 90, PETROL: 100, CNG: 80, ELECTRIC: 9 },
  emissionKgPerUnit: { DIESEL: 2.68, PETROL: 2.31, CNG: 2.75, ELECTRIC: 0.71 },
  loadPenaltyAtFullLoad: 0.2,
  driverCostPerHour: 150,
};

export const FUEL_UNIT: Record<FuelKind, string> = {
  DIESEL: "L",
  PETROL: "L",
  CNG: "kg",
  ELECTRIC: "kWh",
};

export const DEFAULT_WEIGHTS: Weights = {
  time: 100,
  distance: 0,
  cost: 1,
  emissions: 2,
  lateness: 10,
  risk: 5,
};

export const PRIORITY_MULTIPLIER = { LOW: 0.5, NORMAL: 1, HIGH: 2, URGENT: 4 } as const;

/** Fuel/energy consumed for one leg; consumption rises linearly with load. */
export function legFuelUnits(
  distanceKm: number,
  loadKg: number,
  capacityKg: number,
  mileageKmPerUnit: number,
  loadPenaltyAtFullLoad: number,
): number {
  if (distanceKm <= 0) return 0;
  const loadFraction = capacityKg > 0 ? Math.min(1, Math.max(0, loadKg / capacityKg)) : 0;
  const effectiveMileage = mileageKmPerUnit / (1 + loadPenaltyAtFullLoad * loadFraction);
  return distanceKm / effectiveMileage;
}

export interface TripEstimateInput {
  distanceKm: number;
  durationMin: number;
  averageLoadKg: number;
  capacityKg: number;
  fuelType: FuelKind;
  mileageKmPerUnit: number;
}

export function estimateTrip(input: TripEstimateInput, cost: CostModel = DEFAULT_COST_MODEL) {
  const fuelUnits = legFuelUnits(
    input.distanceKm,
    input.averageLoadKg,
    input.capacityKg,
    input.mileageKmPerUnit,
    cost.loadPenaltyAtFullLoad,
  );
  const fuelCost = fuelUnits * cost.fuelPricePerUnit[input.fuelType];
  const driverCost = (input.durationMin / 60) * cost.driverCostPerHour;
  const co2Kg = fuelUnits * cost.emissionKgPerUnit[input.fuelType];
  return {
    fuelUnits,
    fuelUnit: FUEL_UNIT[input.fuelType],
    fuelCost,
    driverCost,
    operatingCost: fuelCost + driverCost,
    co2Kg,
    co2PerKm: input.distanceKm > 0 ? co2Kg / input.distanceKm : 0,
    assumptions: {
      fuelPricePerUnit: cost.fuelPricePerUnit[input.fuelType],
      emissionKgPerUnit: cost.emissionKgPerUnit[input.fuelType],
      loadPenaltyAtFullLoad: cost.loadPenaltyAtFullLoad,
      driverCostPerHour: cost.driverCostPerHour,
      mileageKmPerUnit: input.mileageKmPerUnit,
    },
  };
}
