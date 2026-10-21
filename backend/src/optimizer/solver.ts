import { PRIORITY_MULTIPLIER } from "./costModel";
import { emptyMetrics, evaluateRoute, legTravel, type EvalContext } from "./evaluate";
import { createRng, type Rng } from "./rng";
import type {
  Instance,
  ObjectiveBreakdown,
  OptOrder,
  RouteEvaluation,
  RouteMetrics,
  RouteStop,
  Solution,
  SolvedRoute,
  UnservedOrder,
} from "./types";
import { validatePlan } from "./validate";

export class InstanceError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid optimization input: ${problems.join("; ")}`);
    this.name = "InstanceError";
  }
}

/** Rejects malformed input instead of producing a misleading plan. */
export function checkInstance(inst: Instance): void {
  const problems: string[] = [];
  const locs = inst.matrix.index;
  if (inst.vehicles.length === 0) problems.push("at least one eligible vehicle is required");
  if (inst.orders.length === 0) problems.push("at least one order is required");
  const seenOrders = new Set<number>();
  for (const o of inst.orders) {
    if (seenOrders.has(o.id)) problems.push(`order ${o.id} listed twice`);
    seenOrders.add(o.id);
    if (!locs.has(o.pickupLocationId) || !locs.has(o.dropLocationId)) problems.push(`order ${o.label} has unknown locations`);
    if (!(o.weightKg > 0)) problems.push(`order ${o.label} weight must be positive`);
    if (o.serviceMinutes < 0) problems.push(`order ${o.label} service time must be ≥ 0`);
    if (o.windowStartMin != null && o.windowEndMin != null && o.windowEndMin < o.windowStartMin) {
      problems.push(`order ${o.label} window ends before it starts`);
    }
  }
  const seenVehicles = new Set<number>();
  for (const v of inst.vehicles) {
    if (seenVehicles.has(v.id)) problems.push(`vehicle ${v.id} listed twice`);
    seenVehicles.add(v.id);
    if (!(v.capacityKg > 0)) problems.push(`vehicle ${v.label} capacity must be positive`);
    if (!(v.mileageKmPerUnit > 0)) problems.push(`vehicle ${v.label} mileage must be positive`);
    if (!(v.avgSpeedKmph > 0)) problems.push(`vehicle ${v.label} speed must be positive`);
    if (!(v.maxShiftMinutes > 0)) problems.push(`vehicle ${v.label} shift limit must be positive`);
    if (!locs.has(v.depotLocationId)) problems.push(`vehicle ${v.label} depot is not in the distance matrix`);
  }
  for (const [k, val] of Object.entries(inst.weights)) {
    if (!(val >= 0) || !Number.isFinite(val)) problems.push(`weight ${k} must be a non-negative number`);
  }
  if (!(inst.options.maxIterations >= 0)) problems.push("maxIterations must be ≥ 0");
  if (problems.length) throw new InstanceError(problems);
}

interface State {
  routes: RouteStop[][];
  evals: RouteEvaluation[];
  unserved: Set<number>;
}

interface Insertion {
  vehicleIdx: number;
  route: RouteStop[];
  evaluation: RouteEvaluation;
  delta: number;
}

const penaltyOf = (inst: Instance, o: OptOrder) => inst.options.unservedPenalty * PRIORITY_MULTIPLIER[o.priority];

function totalObjective(inst: Instance, ctx: EvalContext, s: State): number {
  let total = 0;
  for (const e of s.evals) total += e.objective;
  for (const id of s.unserved) total += penaltyOf(inst, ctx.orders.get(id)!);
  return total;
}

function withoutOrder(route: RouteStop[], orderId: number): RouteStop[] {
  return route.filter((s) => s.orderId !== orderId);
}

/** Cheapest feasible position for an order's pickup+drop pair across the given vehicles. */
function bestInsertion(inst: Instance, ctx: EvalContext, s: State, order: OptOrder, vehicleIdxs?: number[]): Insertion | null {
  let best: Insertion | null = null;
  const candidates = vehicleIdxs ?? inst.vehicles.map((_, i) => i);
  for (const vi of candidates) {
    const vehicle = inst.vehicles[vi];
    if (order.weightKg > vehicle.capacityKg) continue;
    const route = s.routes[vi];
    const base = s.evals[vi].objective;
    const n = route.length;
    for (let i = 0; i <= n; i++) {
      for (let j = i; j <= n; j++) {
        const candidate = route.slice(0, i);
        candidate.push({ kind: "PICKUP", orderId: order.id });
        candidate.push(...route.slice(i, j));
        candidate.push({ kind: "DROP", orderId: order.id });
        candidate.push(...route.slice(j));
        const ev = evaluateRoute(inst, ctx, vehicle, candidate);
        if (!ev.feasible) continue;
        const delta = ev.objective - base;
        if (!best || delta < best.delta - 1e-9) best = { vehicleIdx: vi, route: candidate, evaluation: ev, delta };
      }
    }
  }
  return best;
}

function apply(s: State, ins: Insertion, orderId: number) {
  s.routes[ins.vehicleIdx] = ins.route;
  s.evals[ins.vehicleIdx] = ins.evaluation;
  s.unserved.delete(orderId);
}

function orderSequence(inst: Instance): OptOrder[] {
  return [...inst.orders].sort(
    (a, b) =>
      PRIORITY_MULTIPLIER[b.priority] - PRIORITY_MULTIPLIER[a.priority] ||
      (a.windowEndMin ?? Infinity) - (b.windowEndMin ?? Infinity) ||
      a.id - b.id,
  );
}

/** Baseline: deterministic cheapest-insertion construction. */
function greedy(inst: Instance, ctx: EvalContext): State {
  const s: State = {
    routes: inst.vehicles.map(() => []),
    evals: inst.vehicles.map(() => ({ feasible: true, stops: [], metrics: emptyMetrics(), objective: 0 })),
    unserved: new Set(inst.orders.map((o) => o.id)),
  };
  for (const order of orderSequence(inst)) {
    const ins = bestInsertion(inst, ctx, s, order);
    if (ins) apply(s, ins, order.id);
  }
  return s;
}

function servedOrderIds(s: State): number[] {
  const ids: number[] = [];
  for (const r of s.routes) for (const st of r) if (st.kind === "PICKUP") ids.push(st.orderId);
  return ids;
}

function vehicleOf(s: State, orderId: number): number {
  return s.routes.findIndex((r) => r.some((st) => st.orderId === orderId));
}

/** Best-improvement relocate + re-insert local search until a local optimum. */
function localSearch(inst: Instance, ctx: EvalContext, s: State, budget: { left: number }): number {
  let passes = 0;
  let improved = true;
  while (improved && budget.left > 0) {
    improved = false;
    passes++;
    // Try to serve orders that are still unserved.
    for (const id of [...s.unserved]) {
      const ins = bestInsertion(inst, ctx, s, ctx.orders.get(id)!);
      budget.left--;
      if (ins) {
        apply(s, ins, id);
        improved = true;
      }
    }
    // Relocate each served order to its best position anywhere.
    for (const id of servedOrderIds(s)) {
      if (budget.left <= 0) break;
      budget.left--;
      const from = vehicleOf(s, id);
      const reduced = withoutOrder(s.routes[from], id);
      const reducedEval = evaluateRoute(inst, ctx, inst.vehicles[from], reduced);
      if (!reducedEval.feasible) continue;
      const saved = s.evals[from].objective - reducedEval.objective;
      const trial: State = {
        routes: s.routes.map((r, i) => (i === from ? reduced : r)),
        evals: s.evals.map((e, i) => (i === from ? reducedEval : e)),
        unserved: s.unserved,
      };
      const ins = bestInsertion(inst, ctx, trial, ctx.orders.get(id)!);
      if (ins && ins.delta < saved - 1e-6) {
        s.routes[from] = reduced;
        s.evals[from] = reducedEval;
        apply(s, ins, id);
        improved = true;
      }
    }
    // Exchange: free a vehicle by moving/dropping a served order so an unserved
    // order fits; accepted only if the total objective (incl. penalties) improves.
    if (s.unserved.size && budget.left > 0 && exchangeUnserved(inst, ctx, s, budget)) improved = true;
  }
  return passes;
}

function exchangeUnserved(inst: Instance, ctx: EvalContext, s: State, budget: { left: number }): boolean {
  const before = totalObjective(inst, ctx, s);
  for (const u of [...s.unserved]) {
    const uOrder = ctx.orders.get(u)!;
    for (const id of servedOrderIds(s)) {
      if (budget.left-- <= 0) return false;
      const from = vehicleOf(s, id);
      if (inst.vehicles[from].capacityKg < uOrder.weightKg) continue;
      const trial = cloneState(s);
      trial.routes[from] = withoutOrder(trial.routes[from], id);
      trial.evals[from] = evaluateRoute(inst, ctx, inst.vehicles[from], trial.routes[from]);
      if (!trial.evals[from].feasible) continue;
      trial.unserved.add(id);
      const insU = bestInsertion(inst, ctx, trial, uOrder, [from]);
      if (!insU) continue;
      apply(trial, insU, u);
      const insS = bestInsertion(inst, ctx, trial, ctx.orders.get(id)!);
      if (insS) apply(trial, insS, id);
      if (totalObjective(inst, ctx, trial) < before - 1e-6) {
        s.routes = trial.routes;
        s.evals = trial.evals;
        s.unserved = trial.unserved;
        return true;
      }
    }
  }
  return false;
}

function cloneState(s: State): State {
  return { routes: s.routes.map((r) => [...r]), evals: [...s.evals], unserved: new Set(s.unserved) };
}

/** Seeded simulated annealing over remove-and-reinsert moves, then local-search polish. */
function simulatedAnnealing(inst: Instance, ctx: EvalContext, start: State, rng: Rng, convergence: Solution["convergence"]) {
  let cur = cloneState(start);
  let curObj = totalObjective(inst, ctx, cur);
  let best = cloneState(cur);
  let bestObj = curObj;
  const iterations = inst.options.maxIterations;
  const routeObjs = cur.evals.filter((e) => e.objective > 0).map((e) => e.objective);
  const t0 = Math.max(1, (routeObjs.reduce((a, b) => a + b, 0) / Math.max(1, routeObjs.length)) * 0.05);
  const tEnd = t0 * 1e-3;
  const alpha = iterations > 1 ? Math.pow(tEnd / t0, 1 / iterations) : 1;
  let temp = t0;
  const every = Math.max(1, Math.floor(iterations / 50));

  for (let it = 1; it <= iterations; it++) {
    const trial = cloneState(cur);
    const served = servedOrderIds(trial);
    const unserved = [...trial.unserved];
    if (unserved.length && (served.length === 0 || rng.next() < 0.3)) {
      const id = unserved[rng.int(unserved.length)];
      const ins = bestInsertion(inst, ctx, trial, ctx.orders.get(id)!);
      if (ins) apply(trial, ins, id);
    } else if (served.length) {
      const id = served[rng.int(served.length)];
      const from = vehicleOf(trial, id);
      trial.routes[from] = withoutOrder(trial.routes[from], id);
      trial.evals[from] = evaluateRoute(inst, ctx, inst.vehicles[from], trial.routes[from]);
      trial.unserved.add(id);
      if (!trial.evals[from].feasible) continue;
      // Re-insert into a random vehicle (diversification) or anywhere.
      const target = rng.next() < 0.5 ? [rng.int(inst.vehicles.length)] : undefined;
      const ins = bestInsertion(inst, ctx, trial, ctx.orders.get(id)!, target);
      if (ins) apply(trial, ins, id);
    }
    const obj = totalObjective(inst, ctx, trial);
    const delta = obj - curObj;
    if (delta < 0 || rng.next() < Math.exp(-delta / temp)) {
      cur = trial;
      curObj = obj;
      if (obj < bestObj - 1e-9) {
        best = cloneState(trial);
        bestObj = obj;
      }
    }
    temp *= alpha;
    if (it % every === 0) convergence.push({ iteration: it, best: bestObj });
  }
  return best;
}

function sumMetrics(list: RouteMetrics[]): RouteMetrics {
  const t = emptyMetrics();
  for (const m of list) {
    t.distanceKm += m.distanceKm;
    t.durationMin += m.durationMin;
    t.drivingMin += m.drivingMin;
    t.waitingMin += m.waitingMin;
    t.fuelUnits += m.fuelUnits;
    t.fuelCost += m.fuelCost;
    t.driverCost += m.driverCost;
    t.operatingCost += m.operatingCost;
    t.co2Kg += m.co2Kg;
    t.latenessMin += m.latenessMin;
    t.risk += m.risk;
    t.maxLoadKg = Math.max(t.maxLoadKg, m.maxLoadKg);
  }
  t.utilizationPct = list.length ? list.reduce((a, m) => a + m.utilizationPct, 0) / list.length : 0;
  return t;
}

/** Explains why an order could not be placed in any route. */
function unservedReason(inst: Instance, order: OptOrder): string {
  const fits = inst.vehicles.filter((v) => v.capacityKg >= order.weightKg);
  if (fits.length === 0) return `Weight ${order.weightKg} kg exceeds the capacity of every eligible vehicle`;
  const reachable = fits.some((v) => {
    const a = legTravel(inst, v, v.depotLocationId, order.pickupLocationId);
    const b = legTravel(inst, v, order.pickupLocationId, order.dropLocationId);
    return Number.isFinite(a.distanceKm) && Number.isFinite(b.distanceKm);
  });
  if (!reachable) return "No open road path from any eligible depot to the pickup/drop locations";
  const alone = fits.some((v) => {
    const ctx = { orders: new Map([[order.id, order]]) };
    return evaluateRoute(inst, ctx, v, [
      { kind: "PICKUP", orderId: order.id },
      { kind: "DROP", orderId: order.id },
    ]).feasible;
  });
  if (!alone) return "Cannot meet the delivery time window or driver shift limit even as a dedicated trip";
  return "No remaining vehicle capacity/time to fit this order alongside higher-priority orders";
}

export function objectiveBreakdown(inst: Instance, totals: RouteMetrics, unserved: OptOrder[]): ObjectiveBreakdown {
  const w = inst.weights;
  const b = {
    time: w.time * (totals.durationMin / 60),
    distance: w.distance * totals.distanceKm,
    cost: w.cost * totals.operatingCost,
    emissions: w.emissions * totals.co2Kg,
    lateness: w.lateness * totals.latenessMin,
    risk: w.risk * totals.risk,
    unservedPenalty: unserved.reduce((a, o) => a + penaltyOf(inst, o), 0),
    total: 0,
  };
  b.total = b.time + b.distance + b.cost + b.emissions + b.lateness + b.risk + b.unservedPenalty;
  return b;
}

export function solve(inst: Instance): Solution {
  checkInstance(inst);
  const started = performance.now();
  const ctx: EvalContext = { orders: new Map(inst.orders.map((o) => [o.id, o])) };
  const convergence: Solution["convergence"] = [];
  let state = greedy(inst, ctx);
  convergence.push({ iteration: 0, best: totalObjective(inst, ctx, state) });
  let iterations = 0;

  if (inst.options.algorithm === "LOCAL_SEARCH") {
    const budget = { left: Math.max(1, inst.options.maxIterations) };
    iterations = localSearch(inst, ctx, state, budget);
    convergence.push({ iteration: iterations, best: totalObjective(inst, ctx, state) });
  } else if (inst.options.algorithm === "SIMULATED_ANNEALING") {
    state = simulatedAnnealing(inst, ctx, state, createRng(inst.options.seed), convergence);
    const budget = { left: Math.max(1, inst.options.maxIterations) };
    localSearch(inst, ctx, state, budget);
    iterations = inst.options.maxIterations;
    convergence.push({ iteration: iterations + 1, best: totalObjective(inst, ctx, state) });
  }

  const routes: SolvedRoute[] = [];
  state.routes.forEach((r, i) => {
    if (r.length === 0) return;
    const v = inst.vehicles[i];
    const ev = evaluateRoute(inst, ctx, v, r);
    routes.push({ vehicleId: v.id, vehicleLabel: v.label, driverId: v.driverId, driverName: v.driverName, stops: ev.stops, metrics: ev.metrics });
  });
  const unservedOrders = inst.orders.filter((o) => state.unserved.has(o.id));
  const unserved: UnservedOrder[] = unservedOrders.map((o) => ({ orderId: o.id, label: o.label, reason: unservedReason(inst, o) }));
  const totals = sumMetrics(routes.map((r) => r.metrics));
  const violations = validatePlan(inst, routes, unserved);
  return {
    algorithm: inst.options.algorithm,
    seed: inst.options.seed,
    routes,
    unserved,
    totals: { ...totals, servedOrders: inst.orders.length - unserved.length, vehiclesUsed: routes.length },
    objective: objectiveBreakdown(inst, totals, unservedOrders),
    feasible: violations.length === 0,
    violations,
    iterations,
    convergence,
    runtimeMs: Math.round(performance.now() - started),
    distanceSource: inst.matrix.source,
  };
}
