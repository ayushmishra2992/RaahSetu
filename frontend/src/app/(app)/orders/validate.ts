/**
 * Client-side mirror of the backend order rules (backend/src/modules/orders
 * OrderShape + refinements). The server still validates; this only gives
 * immediate, field-level feedback.
 */
export interface OrderDraft {
  customerName: string;
  customerPhone: string;
  pickupLocationId: string;
  dropLocationId: string;
  weightKg: string;
  priority: string;
  serviceMinutes: string;
  notes: string;
  declaredValue: string;
  readyAt: string | null;
  windowStart: string | null;
  windowEnd: string | null;
}

export type OrderErrors = Partial<Record<keyof OrderDraft, string>>;

export function validateOrder(f: OrderDraft): OrderErrors {
  const e: OrderErrors = {};
  const name = f.customerName.trim();
  if (name.length < 2) e.customerName = "Enter the customer name (at least 2 characters).";
  else if (name.length > 120) e.customerName = "Keep the customer name under 120 characters.";
  if (f.customerPhone.trim().length > 20) e.customerPhone = "Phone number is too long (max 20 characters).";
  if (!f.pickupLocationId) e.pickupLocationId = "Choose a pickup location.";
  if (!f.dropLocationId) e.dropLocationId = "Choose a drop location.";
  else if (f.dropLocationId === f.pickupLocationId) e.dropLocationId = "Pickup and drop must be different locations.";
  const w = Number(f.weightKg);
  if (!f.weightKg || !Number.isInteger(w) || w < 1 || w > 100000) e.weightKg = "Enter a whole number of kg between 1 and 100,000.";
  const s = Number(f.serviceMinutes);
  if (f.serviceMinutes === "" || !Number.isInteger(s) || s < 0 || s > 600) e.serviceMinutes = "Service time must be 0–600 whole minutes.";
  if (f.declaredValue && (!Number.isFinite(Number(f.declaredValue)) || Number(f.declaredValue) < 0)) e.declaredValue = "Declared value can't be negative.";
  if (f.notes.length > 1000) e.notes = "Notes are limited to 1,000 characters.";
  if (f.windowStart && f.windowEnd && new Date(f.windowEnd) <= new Date(f.windowStart)) e.windowEnd = "Window end must be after window start.";
  return e;
}

export function orderBody(f: OrderDraft) {
  return {
    customerName: f.customerName.trim(),
    customerPhone: f.customerPhone.trim() || null,
    pickupLocationId: Number(f.pickupLocationId),
    dropLocationId: Number(f.dropLocationId),
    weightKg: Number(f.weightKg),
    priority: f.priority,
    serviceMinutes: Number(f.serviceMinutes),
    notes: f.notes.trim() || null,
    declaredValue: f.declaredValue ? Number(f.declaredValue) : null,
    readyAt: f.readyAt,
    windowStart: f.windowStart,
    windowEnd: f.windowEnd,
  };
}
