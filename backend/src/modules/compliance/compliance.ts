/**
 * Compliance engine (pure: no database access, so it is unit-tested directly).
 *
 * For each required document type the engine picks the *best* current copy — the
 * non-rejected document with the latest expiry (no expiry beats any date) — so a
 * renewed policy uploaded next to the old, expired one counts as valid.
 */
import type { ComplianceSettings } from "../company/settings";

export type DocState =
  | "COMPLIANT"
  | "EXPIRING_SOON"
  | "EXPIRED"
  | "MISSING"
  | "PENDING_VERIFICATION"
  | "REJECTED"
  | "NOT_APPLICABLE";

export type Verification = "PENDING" | "VERIFIED" | "REJECTED";

export interface DocLike {
  id: number;
  type: string;
  documentNumber: string;
  expiresOn: Date | null;
  verificationStatus: Verification;
  hasFile?: boolean;
}

export interface RequirementResult {
  type: string;
  required: boolean;
  state: DocState;
  documentId: number | null;
  documentNumber: string | null;
  expiresOn: Date | null;
  daysToExpiry: number | null;
  verificationStatus: Verification | null;
  /** True when this item stops dispatch under the company's policy. */
  blocking: boolean;
  message: string;
}

export interface EntityCompliance {
  /** Worst state among required items (NOT_APPLICABLE items ignored). */
  overall: Exclude<DocState, "NOT_APPLICABLE" | "REJECTED">;
  eligible: boolean;
  items: RequirementResult[];
  blockers: string[];
  warnings: string[];
}

const DAY = 86_400_000;
const LABEL: Record<string, string> = {
  RC: "Registration certificate (RC)",
  INSURANCE: "Insurance",
  PUC: "PUC certificate",
  FITNESS: "Fitness certificate",
  PERMIT: "Permit",
  STATE_PERMIT: "State permit",
  FASTAG: "FASTag",
  DRIVING_LICENSE: "Driving licence",
  DRIVER_PHOTO: "Driver photograph",
  KYC_ID: "KYC identity proof",
  OTHER: "Other document",
};
export const docLabel = (t: string) => LABEL[t] ?? t;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Severity order used for `overall` (higher = worse). */
const SEVERITY: Record<EntityCompliance["overall"], number> = {
  COMPLIANT: 0,
  EXPIRING_SOON: 1,
  PENDING_VERIFICATION: 2,
  MISSING: 3,
  EXPIRED: 4,
};

export function daysUntil(d: Date, at: Date) {
  return Math.floor((d.getTime() - at.getTime()) / DAY);
}

/** Best current copy of a document type, or the reason there is none. */
export function pickBest(docs: DocLike[]): { doc: DocLike | null; onlyRejected: boolean } {
  const usable = docs.filter((d) => d.verificationStatus !== "REJECTED");
  if (!usable.length) return { doc: null, onlyRejected: docs.length > 0 };
  const rank = (d: DocLike) => (d.expiresOn ? d.expiresOn.getTime() : Number.POSITIVE_INFINITY);
  // Latest expiry wins; on a tie prefer a verified copy, then the newest record.
  const best = [...usable].sort((a, b) => rank(b) - rank(a) || Number(b.verificationStatus === "VERIFIED") - Number(a.verificationStatus === "VERIFIED") || b.id - a.id)[0];
  return { doc: best, onlyRejected: false };
}

interface Policy {
  alertDays: number;
  blockOnMissing: boolean;
  blockOnUnverified: boolean;
}

function evaluateType(type: string, required: boolean, docs: DocLike[], at: Date, policy: Policy, expiryOverride?: Date | null): RequirementResult {
  const { doc, onlyRejected } = pickBest(docs);
  const label = docLabel(type);
  const base = { type, required, documentId: doc?.id ?? null, documentNumber: doc?.documentNumber ?? null, verificationStatus: doc?.verificationStatus ?? null };
  const expiresOn = expiryOverride !== undefined ? expiryOverride : (doc?.expiresOn ?? null);
  const days = expiresOn ? daysUntil(expiresOn, at) : null;

  if (expiresOn && expiresOn < at) {
    return { ...base, expiresOn, daysToExpiry: days, state: "EXPIRED", blocking: required, message: `${type} expired on ${ymd(expiresOn)}` };
  }
  if (!doc) {
    const state = onlyRejected ? "REJECTED" : "MISSING";
    const message = onlyRejected ? `${label}: every uploaded copy was rejected — upload a valid one` : `${label} has not been added`;
    return { ...base, expiresOn, daysToExpiry: days, state, blocking: required && policy.blockOnMissing, message };
  }
  if (doc.verificationStatus === "PENDING") {
    return { ...base, expiresOn, daysToExpiry: days, state: "PENDING_VERIFICATION", blocking: required && policy.blockOnUnverified, message: `${label} is awaiting verification` };
  }
  if (days !== null && days <= policy.alertDays) {
    return { ...base, expiresOn, daysToExpiry: days, state: "EXPIRING_SOON", blocking: false, message: `${label} expires on ${ymd(expiresOn!)} (${days} day${days === 1 ? "" : "s"})` };
  }
  return { ...base, expiresOn, daysToExpiry: days, state: "COMPLIANT", blocking: false, message: `${label} is valid` };
}

function summarise(items: RequirementResult[], extraBlockers: string[] = [], extraWarnings: string[] = []): EntityCompliance {
  let overall: EntityCompliance["overall"] = "COMPLIANT";
  for (const i of items) {
    if (!i.required || i.state === "NOT_APPLICABLE") continue;
    const s = i.state === "REJECTED" ? "MISSING" : i.state;
    if (SEVERITY[s] > SEVERITY[overall]) overall = s;
  }
  const blockers = [...extraBlockers, ...items.filter((i) => i.blocking).map((i) => i.message)];
  const warnings = [
    ...extraWarnings,
    ...items.filter((i) => !i.blocking && i.state !== "COMPLIANT" && i.state !== "NOT_APPLICABLE" && (i.required || i.state === "EXPIRED")).map((i) => i.message),
  ];
  return { overall, eligible: blockers.length === 0, items, blockers, warnings };
}

export interface VehicleLike {
  type: string;
  fuelType: string;
  documents: DocLike[];
}

export function evaluateVehicle(v: VehicleLike, settings: ComplianceSettings, alertDays: number, at = new Date()): EntityCompliance {
  const policy: Policy = { alertDays, blockOnMissing: settings.blockOnMissing, blockOnUnverified: settings.blockOnUnverified };
  const byType = groupByType(v.documents);
  const items: RequirementResult[] = [];
  const seen = new Set<string>();
  for (const r of settings.vehicleRequirements) {
    if (seen.has(r.type)) continue;
    seen.add(r.type);
    const exempt = r.exemptFuelTypes.includes(v.fuelType as never) || r.exemptVehicleTypes.includes(v.type as never);
    if (exempt && byType.has(r.type)) {
      // Not required, but a stored copy is still reported (expired → warning, never a blocker).
      items.push(evaluateType(r.type, false, byType.get(r.type)!, at, policy));
      continue;
    }
    if (exempt) {
      items.push({
        type: r.type,
        required: false,
        state: "NOT_APPLICABLE",
        documentId: null,
        documentNumber: null,
        expiresOn: null,
        daysToExpiry: null,
        verificationStatus: null,
        blocking: false,
        message: `${docLabel(r.type)} is not required for this vehicle (${v.fuelType.toLowerCase()} / ${v.type.toLowerCase().replace("_", " ")})`,
      });
      continue;
    }
    items.push(evaluateType(r.type, true, byType.get(r.type) ?? [], at, policy));
  }
  // Optional documents that exist are still reported (an expired FASTag is worth a warning).
  for (const [type, docs] of byType) if (!seen.has(type)) items.push(evaluateType(type, false, docs, at, policy));
  return summarise(items);
}

export interface DriverLike {
  status: string;
  licenseExpiry: Date;
  documents: DocLike[];
}

export function evaluateDriver(d: DriverLike, settings: ComplianceSettings, alertDays: number, at = new Date()): EntityCompliance {
  const policy: Policy = { alertDays, blockOnMissing: settings.blockOnMissing, blockOnUnverified: settings.blockOnUnverified };
  const byType = groupByType(d.documents);
  const items: RequirementResult[] = [];
  const warnings: string[] = [];
  // The licence expiry on the driver record is authoritative and always enforced.
  const licDocs = byType.get("DRIVING_LICENSE") ?? [];
  const licRequired = settings.driverRequirements.includes("DRIVING_LICENSE");
  const lic = evaluateType("DRIVING_LICENSE", true, licDocs, at, policy, d.licenseExpiry);
  if (lic.state === "EXPIRED") lic.message = `Driving licence expired on ${ymd(d.licenseExpiry)}`;
  if (!licRequired && (lic.state === "MISSING" || lic.state === "REJECTED" || lic.state === "PENDING_VERIFICATION")) {
    // Without a document requirement only the record's expiry matters.
    Object.assign(lic, { state: "COMPLIANT", blocking: false, message: "Driving licence is valid (no copy required)" });
  }
  items.push(lic);
  const best = pickBest(licDocs).doc;
  if (best?.expiresOn && Math.abs(best.expiresOn.getTime() - d.licenseExpiry.getTime()) > DAY) {
    warnings.push(`Licence document expiry ${ymd(best.expiresOn)} differs from the driver record (${ymd(d.licenseExpiry)})`);
  }
  for (const t of settings.driverRequirements) if (t !== "DRIVING_LICENSE") items.push(evaluateType(t, true, byType.get(t) ?? [], at, policy));
  for (const [type, docs] of byType) {
    if (type !== "DRIVING_LICENSE" && !settings.driverRequirements.includes(type as never)) items.push(evaluateType(type, false, docs, at, policy));
  }
  const blockers = d.status === "INACTIVE" ? ["Driver is inactive"] : [];
  return summarise(items, blockers, warnings);
}

// ───────────────────────── Shipment documents ─────────────────────────

export interface OrderDocsLike {
  id: number;
  orderNumber: string;
  declaredValue: number | null;
  ewayBills: Array<{ ewbNumber: string; validUntil: Date | null; vehicleNumber: string | null; status: string }>;
}

export interface ShipmentResult {
  orderId: number;
  orderNumber: string;
  ewayBill: { applicable: boolean | null; state: DocState; message: string; blocking: boolean };
}

export function evaluateShipment(o: OrderDocsLike, settings: ComplianceSettings, at = new Date(), vehicleRegistration?: string): { result: ShipmentResult; blockers: string[]; warnings: string[] } {
  const threshold = settings.ewayBillValueThreshold;
  const active = o.ewayBills.filter((e) => e.status === "ACTIVE");
  const warnings: string[] = [];
  let ewayBill: ShipmentResult["ewayBill"];
  if (threshold === null) {
    ewayBill = { applicable: null, state: "NOT_APPLICABLE", message: "E-Way Bill checks are switched off for this company", blocking: false };
  } else if (o.declaredValue === null) {
    ewayBill = active.length
      ? { applicable: null, state: "COMPLIANT", message: `E-Way Bill ${active[0].ewbNumber} recorded`, blocking: false }
      : { applicable: null, state: "MISSING", message: `${o.orderNumber}: declared value not recorded, so E-Way Bill applicability is unknown`, blocking: false };
  } else if (o.declaredValue <= threshold && !active.length) {
    ewayBill = { applicable: false, state: "NOT_APPLICABLE", message: `Declared value ₹${o.declaredValue} is within ₹${threshold}`, blocking: false };
  } else {
    const best = [...active].sort((a, b) => (b.validUntil?.getTime() ?? Infinity) - (a.validUntil?.getTime() ?? Infinity))[0];
    const block = settings.blockOnMissingShipmentDocs && o.declaredValue > threshold;
    if (!best) {
      ewayBill = { applicable: true, state: "MISSING", message: `${o.orderNumber}: E-Way Bill expected (declared value ₹${o.declaredValue} exceeds ₹${threshold}) but none is recorded`, blocking: block };
    } else if (best.validUntil && best.validUntil < at) {
      ewayBill = { applicable: true, state: "EXPIRED", message: `${o.orderNumber}: E-Way Bill ${best.ewbNumber} expired on ${ymd(best.validUntil)}`, blocking: block };
    } else {
      ewayBill = { applicable: o.declaredValue > threshold, state: "COMPLIANT", message: `E-Way Bill ${best.ewbNumber} recorded`, blocking: false };
      if (vehicleRegistration && best.vehicleNumber && norm(best.vehicleNumber) !== norm(vehicleRegistration)) {
        warnings.push(`${o.orderNumber}: E-Way Bill ${best.ewbNumber} names vehicle ${best.vehicleNumber}, but the trip uses ${vehicleRegistration} — update Part-B on the portal`);
      }
    }
  }
  const blockers = ewayBill.blocking ? [ewayBill.message] : [];
  if (!ewayBill.blocking && (ewayBill.state === "MISSING" || ewayBill.state === "EXPIRED")) warnings.push(ewayBill.message);
  return { result: { orderId: o.id, orderNumber: o.orderNumber, ewayBill }, blockers, warnings };
}

const norm = (s: string) => s.replace(/[\s-]/g, "").toUpperCase();

// ───────────────────────── Role-based redaction ─────────────────────────

export const KYC_DOC_TYPES: ReadonlySet<string> = new Set(["KYC_ID"]);
/** Shown instead of a KYC item's own message to callers without kyc:read (explains a block without identity data). */
export const KYC_HIDDEN_MESSAGE = "A KYC record needs attention (details are visible to admins and managers only)";

export interface ComplianceVisibility {
  /** May see KYC items (kyc:read). */
  kyc: boolean;
  /** May see document numbers and ids (documents:read). */
  documents: boolean;
}

/**
 * Remove what the caller may not see from an evaluated compliance result. Eligibility
 * is unchanged (the engine always evaluates everything); only the explanation is
 * trimmed: KYC items and their messages are replaced by a neutral line, and document
 * numbers/ids are blanked for roles without documents:read.
 */
export function redactCompliance(c: EntityCompliance, v: ComplianceVisibility): EntityCompliance {
  const hiddenMessages = new Set(v.kyc ? [] : c.items.filter((i) => KYC_DOC_TYPES.has(i.type)).map((i) => i.message));
  const items = c.items
    .filter((i) => v.kyc || !KYC_DOC_TYPES.has(i.type))
    .map((i) => (v.documents ? i : { ...i, documentId: null, documentNumber: null }));
  const trim = (list: string[]) => {
    const kept = list.filter((m) => !hiddenMessages.has(m));
    return kept.length < list.length ? [...kept, KYC_HIDDEN_MESSAGE] : kept;
  };
  return { ...c, items, blockers: trim(c.blockers), warnings: trim(c.warnings) };
}

function groupByType(docs: DocLike[]) {
  const m = new Map<string, DocLike[]>();
  for (const d of docs) m.set(d.type, [...(m.get(d.type) ?? []), d]);
  return m;
}
