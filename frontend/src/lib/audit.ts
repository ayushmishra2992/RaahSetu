/**
 * Readable descriptions for audit events. Action names come from the backend
 * as `entity.verb` (e.g. "order.updated", "road_edge.closed").
 */
const ENTITY_LABEL: Record<string, string> = {
  billing: "Billing document",
  company: "Company profile",
  document: "Compliance document",
  driver: "Driver",
  fuel: "Fuel record",
  location: "Location",
  order: "Order",
  road_edge: "Road segment",
  road_node: "Road node",
  user: "User",
  vehicle: "Vehicle",
};

const VERB_LABEL: Record<string, string> = {
  password_changed: "password changed",
  recorded: "logged",
  opened: "reopened",
};

export function describeAction(action: string): string {
  const [entity, ...rest] = action.split(".");
  const verb = rest.join(".");
  const subject = ENTITY_LABEL[entity] ?? humanizeToken(entity);
  if (!verb) return subject;
  return `${subject} ${VERB_LABEL[verb] ?? humanizeToken(verb).toLowerCase()}`;
}

function humanizeToken(s: string) {
  const t = s.replace(/[_-]+/g, " ").trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** In-app link for an audited record, when there is a page for it. */
export function entityHref(entityType: string, entityId: number | null): string | null {
  const id = entityId ?? undefined;
  switch (entityType) {
    case "Trip":
      return id ? `/trips/${id}` : "/trips";
    case "Order":
      return id ? `/orders?open=${id}` : "/orders";
    case "Vehicle":
      return id ? `/vehicles/${id}` : "/vehicles";
    case "Driver":
      return id ? `/drivers/${id}` : "/drivers";
    case "BillingDocument":
      return id ? `/billing/${id}` : "/billing";
    case "Scenario":
      return id ? `/scenarios/${id}` : "/scenarios";
    case "OptimizationRun":
      return id ? `/optiroute/runs/${id}` : "/optiroute";
    case "ComplianceDocument":
      return "/documents";
    case "Location":
    case "RoadEdge":
    case "RoadNode":
      return "/locations";
    case "User":
      return "/users";
    case "Company":
      return "/settings";
    case "FuelRecord":
      return "/greenfleet";
    default:
      return null;
  }
}

const ENTITY_TYPE_LABEL: Record<string, string> = {
  BillingDocument: "Billing document",
  ComplianceDocument: "Compliance document",
  OptimizationRun: "OptiRoute run",
  RoadEdge: "Road segment",
  RoadNode: "Road node",
  FuelRecord: "Fuel record",
};

export function entityLabel(entityType: string): string {
  return ENTITY_TYPE_LABEL[entityType] ?? entityType;
}

/** Flat, readable key/value pairs from audit metadata (never raw JSON). */
export function metadataPairs(metadata: Record<string, unknown> | null | undefined): Array<[string, string]> {
  if (!metadata) return [];
  return Object.entries(metadata)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => [humanizeToken(k.replace(/([a-z])([A-Z])/g, "$1 $2")), formatValue(v)]);
}

function formatValue(v: unknown): string {
  if (v === null) return "—";
  if (Array.isArray(v)) return v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ");
  if (typeof v === "object") return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${String(x)}`).join(", ");
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}
