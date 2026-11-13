export type Role = "ADMIN" | "MANAGER" | "DISPATCHER" | "EMPLOYEE" | "DRIVER";

export interface Settings {
  fuelPricePerUnit: Record<string, number>;
  emissionKgPerUnit: Record<string, number>;
  loadPenaltyAtFullLoad: number;
  driverCostPerHour: number;
  defaultWeights: Weights;
  documentExpiryAlertDays: number;
  currency: string;
}

export interface Company {
  id: number;
  name: string;
  gstNumber: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  settings: Settings;
}

export interface Me {
  user: { id: number; email: string; name: string; role: Role; driver: { id: number; name: string } | null };
  company: Company;
  permissions: string[];
}

export interface Location {
  id: number;
  name: string;
  address: string | null;
  type: "DEPOT" | "WAREHOUSE" | "CUSTOMER" | "OTHER";
  lat: number;
  lng: number;
  roadNodeId: number | null;
  roadNode?: { id: number; name: string } | null;
  /** Location-search details (optional; older API responses omit them). */
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  placeProvider?: string | null;
  providerPlaceId?: string | null;
  coordsSource?: "MANUAL" | "SEARCH" | "PIN_ADJUSTED";
}

export interface Vehicle {
  id: number;
  registrationNumber: string;
  type: string;
  make: string | null;
  model: string | null;
  year: number | null;
  capacityKg: number;
  fuelType: "DIESEL" | "PETROL" | "CNG" | "ELECTRIC";
  mileageKmPerUnit: number;
  avgSpeedKmph: number;
  status: "AVAILABLE" | "ON_TRIP" | "MAINTENANCE" | "INACTIVE";
  odometerKm: number;
  depotLocationId: number | null;
  depotLocation?: { id: number; name: string } | null;
}

export interface Driver {
  id: number;
  name: string;
  phone: string;
  licenseNumber: string;
  licenseExpiry: string;
  status: "AVAILABLE" | "ON_TRIP" | "OFF_DUTY" | "INACTIVE";
  maxShiftHours: number;
  userId: number | null;
  user?: { id: number; email: string } | null;
}

export interface ComplianceDoc {
  id: number;
  type: string;
  documentNumber: string;
  issuedOn: string | null;
  expiresOn: string | null;
  notes: string | null;
  vehicleId: number | null;
  driverId: number | null;
  vehicle?: { id: number; registrationNumber: string } | null;
  driver?: { id: number; name: string } | null;
  fileName: string | null;
  hasFile: boolean;
  expiryState?: "EXPIRED" | "EXPIRING_SOON" | "VALID" | "NO_EXPIRY";
}

export interface Order {
  id: number;
  orderNumber: string;
  customerName: string;
  customerPhone: string | null;
  pickupLocationId: number;
  dropLocationId: number;
  pickupLocation?: { id: number; name: string };
  dropLocation?: { id: number; name: string };
  weightKg: number;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  readyAt: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  serviceMinutes: number;
  status: "PENDING" | "ASSIGNED" | "IN_TRANSIT" | "DELIVERED" | "CANCELLED";
  notes: string | null;
  declaredValue: number | null;
  createdAt: string;
}

export interface TripStop {
  id: number;
  sequence: number;
  type: "DEPOT_START" | "PICKUP" | "DROP" | "DEPOT_END";
  locationId: number;
  location: Location;
  orderId: number | null;
  order: { id: number; orderNumber: string; customerName: string; weightKg: number; windowEnd: string | null; status: string } | null;
  plannedArrival: string | null;
  actualArrival: string | null;
  status: "PENDING" | "ARRIVED" | "COMPLETED" | "SKIPPED";
}

export interface Trip {
  id: number;
  tripNumber: string;
  vehicleId: number;
  driverId: number;
  status: "PLANNED" | "DISPATCHED" | "IN_TRANSIT" | "COMPLETED" | "CANCELLED";
  plannedStart: string;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  plannedDistanceKm: number | null;
  estFuelUnits: number | null;
  estCost: number | null;
  estCo2Kg: number | null;
  notes: string | null;
  vehicle: Vehicle;
  driver: Driver;
  optimizationRunId: number | null;
  _count?: { stops: number };
}

export interface TripDetail extends Trip {
  stops: TripStop[];
  events: Array<{ id: number; fromStatus: string | null; toStatus: string; note: string | null; createdAt: string }>;
  billingDocuments: Array<{ id: number; kind: string; number: string; status: string; total: number }>;
  optimizationRun: { id: number; name: string | null; algorithm: string } | null;
  simulatedPosition: { simulated: true; lat: number; lng: number; progressPct: number; nextStop: string | null; etaToNextStop: string | null; delayMinutes: number } | null;
}

export interface Weights {
  time: number;
  distance: number;
  cost: number;
  emissions: number;
  lateness: number;
  risk: number;
}

export interface Metrics {
  distanceKm: number;
  durationMin: number;
  drivingMin: number;
  waitingMin: number;
  fuelUnits: number;
  fuelCost: number;
  driverCost: number;
  operatingCost: number;
  co2Kg: number;
  latenessMin: number;
  risk: number;
  maxLoadKg: number;
  utilizationPct: number;
}

export interface PlanStop {
  sequence: number;
  type: "DEPOT_START" | "PICKUP" | "DROP" | "DEPOT_END";
  orderId: number | null;
  locationId: number;
  arrivalMin: number;
  serviceStartMin: number;
  departureMin: number;
  waitMin: number;
  latenessMin: number;
  loadAfterKg: number;
  legDistanceKm: number;
}

export interface RunResult {
  algorithm: string;
  seed: number;
  routes: Array<{ vehicleId: number; vehicleLabel: string; driverId: number; driverName?: string; stops: PlanStop[]; metrics: Metrics }>;
  unserved: Array<{ orderId: number; label: string; reason: string }>;
  totals: Metrics & { servedOrders: number; vehiclesUsed: number };
  objective: Record<"time" | "distance" | "cost" | "emissions" | "lateness" | "risk" | "unservedPenalty" | "total", number>;
  feasible: boolean;
  violations: Array<{ code: string; message: string }>;
  iterations: number;
  convergence: Array<{ iteration: number; best: number }>;
  runtimeMs: number;
  distanceSource: string;
  planStart: string;
  exclusions: Array<{ kind: string; id: number; label: string; reason: string }>;
  assumptions: string[];
  locations: Record<string, { name: string; lat: number; lng: number }>;
  orders: Record<string, { label: string; customerName: string; weightKg: number; priority: string; virtual?: boolean }>;
}

export interface RunSummary {
  id: number;
  name: string | null;
  algorithm: string;
  seed: number;
  objective: number | null;
  feasible: boolean;
  totalDistanceKm: number | null;
  totalCo2Kg: number | null;
  totalCost: number | null;
  unservedCount: number;
  runtimeMs: number;
  distanceSource: string;
  dispatchedAt: string | null;
  createdAt: string;
}

export interface Run extends RunSummary {
  request: Record<string, unknown> & { weights?: Partial<Weights>; hardTimeWindows: boolean; returnToDepot: boolean; maxIterations: number };
  result: RunResult;
  trips: Array<{ id: number; tripNumber: string; status: string; vehicleId: number }>;
}

export interface Scenario {
  id: number;
  name: string;
  type: "VEHICLE_BREAKDOWN" | "ROAD_CLOSURE" | "URGENT_ORDER" | "DRIVER_UNAVAILABLE";
  params: Record<string, unknown>;
  status: "EVALUATED" | "APPROVED" | "REJECTED";
  baseRunId: number;
  resultRunId: number | null;
  comparison: {
    base: Record<string, number>;
    scenario: Record<string, number>;
    delta: Record<string, number>;
    reassignedOrders: Array<{ orderId: number; label: string; from: string | null; to: string | null }>;
    newlyUnserved: Array<{ orderId: number; label: string; reason: string }>;
    summary: string;
  } | null;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface BillingDoc {
  id: number;
  kind: "INVOICE" | "DELIVERY_CHALLAN";
  number: string;
  status: "DRAFT" | "ISSUED" | "PAID" | "CANCELLED";
  tripId: number | null;
  trip?: { id: number; tripNumber: string } | null;
  customerName: string;
  customerGstin: string | null;
  customerAddress: string | null;
  taxRatePercent: number;
  subtotal: number;
  taxAmount: number;
  total: number;
  issuedAt: string | null;
  dueDate: string | null;
  notes: string | null;
  createdAt: string;
  items?: Array<{ id: number; description: string; quantity: number; unit: string; rate: number; amount: number }>;
  seller?: { name: string; gstNumber: string | null; address: string | null; city: string | null; state: string | null };
}

export interface RoadNode {
  id: number;
  name: string;
  lat: number;
  lng: number;
}

export interface RoadEdge {
  id: number;
  fromNodeId: number;
  toNodeId: number;
  distanceKm: number;
  speedKmph: number;
  bidirectional: boolean;
  isClosed: boolean;
  name: string | null;
}
