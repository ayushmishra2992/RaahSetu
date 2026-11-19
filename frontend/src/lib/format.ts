const dateTime = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" });
const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

export const fmtDateTime = (v?: string | Date | null) => (v ? dateTime.format(new Date(v)) : "—");
export const fmtDate = (v?: string | Date | null) => (v ? dateOnly.format(new Date(v)) : "—");
export const fmtMoney = (v?: number | null) => (v == null ? "—" : inr.format(v));
const inrExact = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Exact rupees and paise, for invoices and challans. */
export const fmtAmount = (v?: number | null) => (v == null ? "—" : inrExact.format(v));
export const fmtNum = (v?: number | null, unit?: string) => (v == null ? "—" : `${num.format(v)}${unit ? ` ${unit}` : ""}`);
export const fmtMinutes = (m?: number | null) => {
  if (m == null) return "—";
  const h = Math.floor(m / 60);
  const mm = Math.round(m % 60);
  return h ? `${h}h ${mm}m` : `${mm}m`;
};
export const humanize = (s?: string | null) => (s ? s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "—");

/** Value for <input type="datetime-local"> in the browser's local time zone. */
export function toLocalInput(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = new Date(d);
  const off = date.getTimezoneOffset();
  return new Date(date.getTime() - off * 60000).toISOString().slice(0, 16);
}

export function fromLocalInput(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}

export const FUEL_UNIT: Record<string, string> = { DIESEL: "L", PETROL: "L", CNG: "kg", ELECTRIC: "kWh" };

/** Whole days from now until `d` (negative when in the past). Kept out of components so renders stay pure. */
export function daysUntil(d: string | Date): number {
  return Math.floor((new Date(d).getTime() - Date.now()) / 86_400_000);
}

/** "Expired 3 days ago" / "Expires today" / "Expires in 12 days" for a whole-day offset. */
export function fmtRelDays(days: number, verbs: [past: string, future: string] = ["Expired", "Expires"]): string {
  if (days < 0) return `${verbs[0]} ${-days} day${days === -1 ? "" : "s"} ago`;
  if (days === 0) return `${verbs[1]} today`;
  return `${verbs[1]} in ${days} day${days === 1 ? "" : "s"}`;
}

export function isPast(d: string | Date | null | undefined): boolean {
  return !!d && new Date(d).getTime() < Date.now();
}

/** Today's date as YYYY-MM-DD in local time. */
export function todayIso(): string {
  return toLocalInput(new Date()).slice(0, 10);
}

const DOC_TYPE: Record<string, string> = {
  RC: "RC",
  PUC: "PUC",
  INSURANCE: "Insurance",
  FITNESS: "Fitness",
  PERMIT: "Permit (national)",
  STATE_PERMIT: "State permit",
  FASTAG: "FASTag",
  DRIVING_LICENSE: "Driving licence",
  DRIVER_PHOTO: "Driver photo",
  KYC_ID: "KYC identity proof",
  OTHER: "Other",
};
export const VEHICLE_DOC_TYPES = ["RC", "INSURANCE", "PUC", "FITNESS", "PERMIT", "STATE_PERMIT", "FASTAG", "OTHER"] as const;
export const DRIVER_DOC_TYPES = ["DRIVING_LICENSE", "DRIVER_PHOTO", "KYC_ID", "OTHER"] as const;
/** Compliance document type label (keeps acronyms such as RC and PUC upper-case). */
export const docTypeLabel = (t?: string | null) => (t ? (DOC_TYPE[t] ?? humanize(t)) : "—");

export type ExpiryState = "EXPIRED" | "EXPIRING_SOON" | "VALID" | "NO_EXPIRY";
/** Same rule as the backend's documents `expiryState()`, for records that don't carry it. */
export function expiryStateOf(expiresOn: string | Date | null | undefined, alertDays: number, now = Date.now()): ExpiryState {
  if (!expiresOn) return "NO_EXPIRY";
  const days = Math.floor((new Date(expiresOn).getTime() - now) / 86_400_000);
  if (days < 0) return "EXPIRED";
  if (days <= alertDays) return "EXPIRING_SOON";
  return "VALID";
}
