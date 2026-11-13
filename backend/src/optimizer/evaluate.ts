import { legFuelUnits } from "./costModel";
import type {
  EvaluatedStop,
  Instance,
  OptOrder,
  OptVehicle,
  RouteEvaluation,
  RouteMetrics,
  RouteStop,
  Weights,
} from "./types";

export interface EvalContext {
  orders: Map<number, OptOrder>;
}

export function emptyMetrics(): RouteMetrics {
  return {
    distanceKm: 0,
    durationMin: 0,
    drivingMin: 0,
    waitingMin: 0,
    fuelUnits: 0,
    fuelCost: 0,
    driverCost: 0,
    operatingCost: 0,
    co2Kg: 0,
    latenessMin: 0,
    risk: 0,
    maxLoadKg: 0,
    utilizationPct: 0,
  };
}

export function routeObjective(m: RouteMetrics, w: Weights): number {
  return (
    w.time * (m.durationMin / 60) +
    w.distance * m.distanceKm +
    w.cost * m.operatingCost +
    w.emissions * m.co2Kg +
    w.lateness * m.latenessMin +
    w.risk * m.risk
  );
}

export function legTravel(inst: Instance, vehicle: OptVehicle, fromLoc: number, toLoc: number) {
  const i = inst.matrix.index.get(fromLoc);
  const j = inst.matrix.index.get(toLoc);
  if (i === undefined || j === undefined) return { distanceKm: Infinity, minutes: Infinity };
  const distanceKm = inst.matrix.distKm[i][j];
  const base = inst.matrix.timeMin[i][j];
  const capped = (distanceKm / vehicle.avgSpeedKmph) * 60;
  return { distanceKm, minutes: Math.max(base, capped) };
}

/**
 * Simulates one vehicle route and returns its schedule, metrics, objective and
 * whether all hard constraints hold. Pure and deterministic.
 */
export function evaluateRoute(
  inst: Instance,
  ctx: EvalContext,
  vehicle: OptVehicle,
  stops: RouteStop[],
): RouteEvaluation {
  if (stops.length === 0) {
    return { feasible: true, stops: [], metrics: emptyMetrics(), objective: 0 };
  }
  const { cost, options } = inst;
  const fail = (reason: string): RouteEvaluation => ({
    feasible: false,
    reason,
    stops: [],
    metrics: emptyMetrics(),
    objective: Infinity,
  });

  // Initial departure: arrive at the first stop exactly when it can be served.
  const firstOrder = ctx.orders.get(stops[0].orderId);
  if (!firstOrder) return fail("UNKNOWN_ORDER");
  const firstLoc = stops[0].kind === "PICKUP" ? firstOrder.pickupLocationId : firstOrder.dropLocationId;
  const firstLeg = legTravel(inst, vehicle, vehicle.depotLocationId, firstLoc);
  if (!Number.isFinite(firstLeg.distanceKm)) return fail("UNREACHABLE");
  const firstEarliest = stops[0].kind === "PICKUP" ? (firstOrder.readyAtMin ?? 0) : (firstOrder.windowStartMin ?? 0);
  const initialDepart = Math.max(0, firstEarliest - firstLeg.minutes);

  type Schedule = { ok: true; departAt: number; t: number; out: EvaluatedStop[]; m: RouteMetrics } | { ok: false; reason: string };

  /** Simulates the stop sequence from a given departure time (all hard checks except the shift limit). */
  const simulate = (departAt: number): Schedule => {
    const out: EvaluatedStop[] = [
      {
        sequence: 0,
        type: "DEPOT_START",
        orderId: null,
        locationId: vehicle.depotLocationId,
        arrivalMin: departAt,
        serviceStartMin: departAt,
        departureMin: departAt,
        waitMin: 0,
        latenessMin: 0,
        loadAfterKg: 0,
        legDistanceKm: 0,
      },
    ];

    let t = departAt;
    let loc = vehicle.depotLocationId;
    let load = 0;
    const m = emptyMetrics();
    const picked = new Set<number>();
    const dropped = new Set<number>();

    const travel = (to: number) => {
      const leg = legTravel(inst, vehicle, loc, to);
      if (!Number.isFinite(leg.distanceKm)) return null;
      const fuel = legFuelUnits(leg.distanceKm, load, vehicle.capacityKg, vehicle.mileageKmPerUnit, cost.loadPenaltyAtFullLoad);
      m.distanceKm += leg.distanceKm;
      m.drivingMin += leg.minutes;
      m.fuelUnits += fuel;
      m.risk += leg.distanceKm * vehicle.riskFactor;
      t += leg.minutes;
      loc = to;
      return leg;
    };

    for (let s = 0; s < stops.length; s++) {
      const stop = stops[s];
      const order = ctx.orders.get(stop.orderId);
      if (!order) return { ok: false, reason: "UNKNOWN_ORDER" };
      const target = stop.kind === "PICKUP" ? order.pickupLocationId : order.dropLocationId;
      const leg = travel(target);
      if (!leg) return { ok: false, reason: "UNREACHABLE" };
      const arrival = t;
      let earliest = 0;
      let lateness = 0;
      if (stop.kind === "PICKUP") {
        if (picked.has(order.id)) return { ok: false, reason: "DUPLICATE_SERVICE" };
        earliest = order.readyAtMin ?? 0;
      } else {
        if (!picked.has(order.id)) return { ok: false, reason: "PRECEDENCE" };
        if (dropped.has(order.id)) return { ok: false, reason: "DUPLICATE_SERVICE" };
        earliest = order.windowStartMin ?? 0;
      }
      const serviceStart = Math.max(arrival, earliest);
      const wait = serviceStart - arrival;
      if (stop.kind === "DROP" && order.windowEndMin != null && serviceStart > order.windowEndMin + 1e-9) {
        lateness = serviceStart - order.windowEndMin;
        if (options.hardTimeWindows) return { ok: false, reason: "TIME_WINDOW" };
      }
      if (stop.kind === "PICKUP") {
        load += order.weightKg;
        picked.add(order.id);
        if (load > vehicle.capacityKg + 1e-9) return { ok: false, reason: "CAPACITY" };
      } else {
        load -= order.weightKg;
        dropped.add(order.id);
      }
      m.maxLoadKg = Math.max(m.maxLoadKg, load);
      m.waitingMin += wait;
      m.latenessMin += lateness;
      t = serviceStart + order.serviceMinutes;
      out.push({
        sequence: s + 1,
        type: stop.kind,
        orderId: order.id,
        locationId: target,
        arrivalMin: arrival,
        serviceStartMin: serviceStart,
        departureMin: t,
        waitMin: wait,
        latenessMin: lateness,
        loadAfterKg: load,
        legDistanceKm: leg.distanceKm,
      });
    }

    for (const id of picked) if (!dropped.has(id)) return { ok: false, reason: "PRECEDENCE" };

    if (options.returnToDepot) {
      const leg = travel(vehicle.depotLocationId);
      if (!leg) return { ok: false, reason: "UNREACHABLE" };
      out.push({
        sequence: stops.length + 1,
        type: "DEPOT_END",
        orderId: null,
        locationId: vehicle.depotLocationId,
        arrivalMin: t,
        serviceStartMin: t,
        departureMin: t,
        waitMin: 0,
        latenessMin: 0,
        loadAfterKg: 0,
        legDistanceKm: leg.distanceKm,
      });
    }
    return { ok: true, departAt, t, out, m };
  };

  const first = simulate(initialDepart);
  if (!first.ok) return fail(first.reason);

  // Remove avoidable waiting by leaving later (forward time slack): the departure can move
  // later by up to the waiting accumulated before each stop plus that stop's remaining window
  // slack, and moving it by more than the total waiting would only shift the whole route later.
  // Delaying never makes a stop earlier, so readyAt and window starts still hold; the slack cap
  // keeps every stop within its window end (and adds no lateness when windows are soft).
  let cumulativeWait = 0;
  let forwardSlack = Infinity;
  for (const st of first.out) {
    if (st.type !== "PICKUP" && st.type !== "DROP") continue;
    cumulativeWait += st.waitMin;
    const order = ctx.orders.get(st.orderId!)!;
    const latest = st.type === "DROP" && order.windowEndMin != null ? order.windowEndMin : Infinity;
    forwardSlack = Math.min(forwardSlack, cumulativeWait + Math.max(0, latest - st.serviceStartMin));
  }
  const delay = Math.min(forwardSlack, first.m.waitingMin);
  const delayed = delay > 1e-9 ? simulate(first.departAt + delay) : first;
  // The delayed schedule satisfies the same checks by construction; keep the original if it does not.
  const run = delayed.ok ? delayed : first;
  const { t, out, m, departAt } = run;

  m.durationMin = t - departAt;
  if (m.durationMin > vehicle.maxShiftMinutes + 1e-9) return fail("SHIFT_LIMIT");

  m.fuelCost = m.fuelUnits * cost.fuelPricePerUnit[vehicle.fuelType];
  m.driverCost = (m.durationMin / 60) * cost.driverCostPerHour;
  m.operatingCost = m.fuelCost + m.driverCost;
  m.co2Kg = m.fuelUnits * cost.emissionKgPerUnit[vehicle.fuelType];
  m.utilizationPct = vehicle.capacityKg > 0 ? (m.maxLoadKg / vehicle.capacityKg) * 100 : 0;

  return { feasible: true, stops: out, metrics: m, objective: routeObjective(m, inst.weights) };
}
