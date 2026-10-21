import { legTravel } from "./evaluate";
import type { Instance, SolvedRoute, UnservedOrder, Violation } from "./types";

/**
 * Independent hard-constraint check of a finished plan. It re-simulates every
 * route from the raw instance (it does not trust the solver's schedule), so a
 * plan is only marked feasible if this returns no violations.
 */
export function validatePlan(inst: Instance, routes: SolvedRoute[], unserved: UnservedOrder[]): Violation[] {
  const violations: Violation[] = [];
  const orders = new Map(inst.orders.map((o) => [o.id, o]));
  const vehicles = new Map(inst.vehicles.map((v) => [v.id, v]));
  const servedBy = new Map<number, number>();
  const usedVehicles = new Set<number>();

  for (const route of routes) {
    const vehicle = vehicles.get(route.vehicleId);
    if (!vehicle) {
      violations.push({ code: "UNKNOWN_ENTITY", vehicleId: route.vehicleId, message: "Route uses an unknown vehicle" });
      continue;
    }
    if (usedVehicles.has(vehicle.id)) {
      violations.push({ code: "DUPLICATE_SERVICE", vehicleId: vehicle.id, message: "Vehicle has more than one route" });
    }
    usedVehicles.add(vehicle.id);

    const serviceStops = route.stops.filter((s) => s.type === "PICKUP" || s.type === "DROP");
    let loc = vehicle.depotLocationId;
    let t = route.stops[0]?.departureMin ?? 0;
    const start = t;
    let load = 0;
    const picked = new Set<number>();
    const dropped = new Set<number>();

    for (const stop of serviceStops) {
      const order = stop.orderId != null ? orders.get(stop.orderId) : undefined;
      if (!order) {
        violations.push({ code: "UNKNOWN_ENTITY", vehicleId: vehicle.id, orderId: stop.orderId ?? undefined, message: "Stop references an unknown order" });
        continue;
      }
      const expectedLoc = stop.type === "PICKUP" ? order.pickupLocationId : order.dropLocationId;
      const leg = legTravel(inst, vehicle, loc, expectedLoc);
      if (!Number.isFinite(leg.distanceKm)) {
        violations.push({ code: "UNREACHABLE", vehicleId: vehicle.id, orderId: order.id, message: "No road path for a leg" });
        break;
      }
      t += leg.minutes;
      loc = expectedLoc;
      if (stop.type === "PICKUP") {
        if (picked.has(order.id)) violations.push({ code: "DUPLICATE_SERVICE", vehicleId: vehicle.id, orderId: order.id, message: `Order ${order.label} picked up twice` });
        picked.add(order.id);
        t = Math.max(t, order.readyAtMin ?? 0);
        load += order.weightKg;
        if (load > vehicle.capacityKg + 1e-6) {
          violations.push({ code: "CAPACITY", vehicleId: vehicle.id, orderId: order.id, message: `${vehicle.label} load ${Math.round(load)} kg exceeds capacity ${vehicle.capacityKg} kg` });
        }
      } else {
        if (!picked.has(order.id)) violations.push({ code: "PRECEDENCE", vehicleId: vehicle.id, orderId: order.id, message: `Order ${order.label} delivered before pickup` });
        if (dropped.has(order.id)) violations.push({ code: "DUPLICATE_SERVICE", vehicleId: vehicle.id, orderId: order.id, message: `Order ${order.label} delivered twice` });
        dropped.add(order.id);
        t = Math.max(t, order.windowStartMin ?? 0);
        if (inst.options.hardTimeWindows && order.windowEndMin != null && t > order.windowEndMin + 1e-6) {
          violations.push({ code: "TIME_WINDOW", vehicleId: vehicle.id, orderId: order.id, message: `Order ${order.label} delivered ${Math.round(t - order.windowEndMin)} min after its window` });
        }
        // Only goods actually on board can be unloaded.
        if (picked.has(order.id)) load -= order.weightKg;
      }
      t += order.serviceMinutes;
      const prev = servedBy.get(order.id);
      if (prev !== undefined && prev !== vehicle.id) {
        violations.push({ code: "PRECEDENCE", orderId: order.id, message: `Order ${order.label} split across vehicles` });
      }
      servedBy.set(order.id, vehicle.id);
    }
    for (const id of picked) {
      if (!dropped.has(id)) violations.push({ code: "PRECEDENCE", vehicleId: vehicle.id, orderId: id, message: `Order ${orders.get(id)?.label ?? id} picked up but never delivered` });
    }
    if (inst.options.returnToDepot) {
      const leg = legTravel(inst, vehicle, loc, vehicle.depotLocationId);
      t += leg.minutes;
    }
    if (t - start > vehicle.maxShiftMinutes + 1e-6) {
      violations.push({ code: "SHIFT_LIMIT", vehicleId: vehicle.id, message: `${vehicle.label} route lasts ${Math.round(t - start)} min, limit ${vehicle.maxShiftMinutes} min` });
    }
  }

  const unservedIds = new Set(unserved.map((u) => u.orderId));
  for (const o of inst.orders) {
    const served = servedBy.has(o.id);
    if (served && unservedIds.has(o.id)) {
      violations.push({ code: "DUPLICATE_SERVICE", orderId: o.id, message: `Order ${o.label} is both served and unserved` });
    }
    if (!served && !unservedIds.has(o.id)) {
      violations.push({ code: "MISSING_ORDER", orderId: o.id, message: `Order ${o.label} is neither served nor reported as unserved` });
    }
  }
  return violations;
}
