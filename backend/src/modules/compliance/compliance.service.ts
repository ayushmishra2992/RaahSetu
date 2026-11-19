import { prisma } from "../../config/prisma";
import { getCompanySettings, type CompanySettings } from "../company/settings";
import type { UserRole } from "../../generated/prisma/enums";
import { can } from "../../lib/permissions";
import { evaluateDriver, evaluateShipment, evaluateVehicle, redactCompliance, type ComplianceVisibility, type DocLike, type EntityCompliance, type ShipmentResult } from "./compliance";

/** What a role may see of compliance results (see redactCompliance). */
export function visibilityFor(role: UserRole): ComplianceVisibility {
  return { kyc: can(role, "kyc:read"), documents: can(role, "documents:read") };
}

type Db = Pick<typeof prisma, "vehicle" | "driver" | "order" | "complianceDocument">;

const docSelect = { id: true, type: true, documentNumber: true, expiresOn: true, verificationStatus: true, storageKey: true } as const;

function toDocs(docs: Array<{ id: number; type: string; documentNumber: string; expiresOn: Date | null; verificationStatus: DocLike["verificationStatus"]; storageKey?: string | null }>): DocLike[] {
  return docs.map((d) => ({ id: d.id, type: d.type, documentNumber: d.documentNumber, expiresOn: d.expiresOn, verificationStatus: d.verificationStatus, hasFile: !!d.storageKey }));
}

export function vehicleCompliance(
  v: { type: string; fuelType: string; documents: Parameters<typeof toDocs>[0] },
  s: CompanySettings,
  at = new Date(),
): EntityCompliance {
  return evaluateVehicle({ type: v.type, fuelType: v.fuelType, documents: toDocs(v.documents) }, s.compliance, s.documentExpiryAlertDays, at);
}

export function driverCompliance(
  d: { status: string; licenseExpiry: Date; documents: Parameters<typeof toDocs>[0] },
  s: CompanySettings,
  at = new Date(),
): EntityCompliance {
  return evaluateDriver({ status: d.status, licenseExpiry: d.licenseExpiry, documents: toDocs(d.documents) }, s.compliance, s.documentExpiryAlertDays, at);
}

export interface DispatchCheck {
  vehicleLabel: string;
  driverLabel: string;
  vehicle: EntityCompliance;
  driver: EntityCompliance;
  shipments: ShipmentResult[];
  blockers: string[];
  warnings: string[];
  eligible: boolean;
}

/** Full compliance check for putting `orderIds` on `vehicleId` with `driverId` at time `at`. */
export async function dispatchCheck(
  db: Db,
  companyId: number,
  input: { vehicleId: number; driverId: number; orderIds: number[] },
  at = new Date(),
  settings?: CompanySettings,
): Promise<DispatchCheck> {
  const s = settings ?? (await getCompanySettings(companyId));
  const [vehicle, driver, orders] = await Promise.all([
    db.vehicle.findFirstOrThrow({ where: { id: input.vehicleId, companyId }, include: { documents: { select: docSelect } } }),
    db.driver.findFirstOrThrow({ where: { id: input.driverId, companyId }, include: { documents: { select: docSelect } } }),
    db.order.findMany({
      where: { id: { in: input.orderIds }, companyId },
      select: { id: true, orderNumber: true, declaredValue: true, ewayBills: { select: { ewbNumber: true, validUntil: true, vehicleNumber: true, status: true } } },
    }),
  ]);
  const v = vehicleCompliance(vehicle, s, at);
  const d = driverCompliance(driver, s, at);
  const shipments: ShipmentResult[] = [];
  const blockers = [...v.blockers.map((b) => `Vehicle ${vehicle.registrationNumber}: ${b}`), ...d.blockers.map((b) => `Driver ${driver.name}: ${b}`)];
  const warnings = [...v.warnings.map((w) => `Vehicle ${vehicle.registrationNumber}: ${w}`), ...d.warnings.map((w) => `Driver ${driver.name}: ${w}`)];
  for (const o of orders) {
    const r = evaluateShipment(o, s.compliance, at, vehicle.registrationNumber);
    shipments.push(r.result);
    blockers.push(...r.blockers);
    warnings.push(...r.warnings);
  }
  return { vehicleLabel: vehicle.registrationNumber, driverLabel: driver.name, vehicle: v, driver: d, shipments, blockers, warnings, eligible: blockers.length === 0 };
}

/**
 * A dispatch check trimmed to what `visibility` allows. Eligibility is unchanged;
 * hidden items are summarised by a neutral message so a block is still explained.
 */
export function redactDispatchCheck(c: DispatchCheck, visibility: ComplianceVisibility): DispatchCheck {
  const vehicle = redactCompliance(c.vehicle, visibility);
  const driver = redactCompliance(c.driver, visibility);
  const shipmentBlockers = c.shipments.filter((s) => s.ewayBill.blocking).map((s) => s.ewayBill.message);
  const shipmentWarnings = c.warnings.filter((w) => !w.startsWith(`Vehicle ${c.vehicleLabel}: `) && !w.startsWith(`Driver ${c.driverLabel}: `));
  const blockers = [...vehicle.blockers.map((b) => `Vehicle ${c.vehicleLabel}: ${b}`), ...driver.blockers.map((b) => `Driver ${c.driverLabel}: ${b}`), ...shipmentBlockers];
  const warnings = [...vehicle.warnings.map((w) => `Vehicle ${c.vehicleLabel}: ${w}`), ...driver.warnings.map((w) => `Driver ${c.driverLabel}: ${w}`), ...shipmentWarnings];
  return { ...c, vehicle, driver, blockers, warnings };
}

/** Company-wide compliance counts and the items needing attention (dashboard). */
export async function complianceOverview(companyId: number, visibility: ComplianceVisibility, at = new Date()) {
  const s = await getCompanySettings(companyId);
  const [vehicles, drivers] = await Promise.all([
    prisma.vehicle.findMany({ where: { companyId, status: { not: "INACTIVE" } }, include: { documents: { select: docSelect } }, orderBy: { registrationNumber: "asc" } }),
    prisma.driver.findMany({ where: { companyId, status: { not: "INACTIVE" } }, include: { documents: { select: docSelect } }, orderBy: { name: "asc" } }),
  ]);
  const tally = () => ({ COMPLIANT: 0, EXPIRING_SOON: 0, PENDING_VERIFICATION: 0, MISSING: 0, EXPIRED: 0 });
  const vehicleCounts = tally();
  const driverCounts = tally();
  const attention: Array<{ kind: "VEHICLE" | "DRIVER"; id: number; label: string; overall: EntityCompliance["overall"]; eligible: boolean; issues: string[] }> = [];
  for (const v of vehicles) {
    const c = redactCompliance(vehicleCompliance(v, s, at), visibility);
    vehicleCounts[c.overall]++;
    if (c.overall !== "COMPLIANT" || c.warnings.length) attention.push({ kind: "VEHICLE", id: v.id, label: v.registrationNumber, overall: c.overall, eligible: c.eligible, issues: [...c.blockers, ...c.warnings] });
  }
  for (const d of drivers) {
    const c = redactCompliance(driverCompliance(d, s, at), visibility);
    driverCounts[c.overall]++;
    if (c.overall !== "COMPLIANT" || c.warnings.length) attention.push({ kind: "DRIVER", id: d.id, label: d.name, overall: c.overall, eligible: c.eligible, issues: [...c.blockers, ...c.warnings] });
  }
  const severity = { EXPIRED: 0, MISSING: 1, PENDING_VERIFICATION: 2, EXPIRING_SOON: 3, COMPLIANT: 4 } as const;
  attention.sort((a, b) => Number(a.eligible) - Number(b.eligible) || severity[a.overall] - severity[b.overall] || a.label.localeCompare(b.label));
  return {
    evaluatedAt: at.toISOString(),
    policy: s.compliance,
    alertDays: s.documentExpiryAlertDays,
    vehicles: { total: vehicles.length, blocked: attention.filter((a) => a.kind === "VEHICLE" && !a.eligible).length, byState: vehicleCounts },
    drivers: { total: drivers.length, blocked: attention.filter((a) => a.kind === "DRIVER" && !a.eligible).length, byState: driverCounts },
    attention,
  };
}
