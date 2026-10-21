# OptiRoute — model, algorithms and evaluation

OptiRoute decides **which vehicle serves which orders, in which sequence**, under operational constraints. It lives in `backend/src/optimizer/` as pure TypeScript (no database access), behind one function: `solve(instance) → solution`.

## Problem

A multi-vehicle **pickup-and-delivery problem with time windows** (PDPTW):

- Each order has a pickup location, drop location, weight, priority, optional ready time, optional delivery window `[windowStart, windowEnd]` and a service time.
- Each vehicle starts at its depot (optionally returns), has a capacity, fuel type, mileage, average speed and a paired driver whose shift limit caps route duration.

### Hard constraints (never violated in a plan marked feasible)

1. Load ≤ capacity at every point of the route.
2. Pickup before drop, on the same vehicle; each order served at most once.
3. Drop service starts no later than `windowEnd` (unless *soft windows* are selected, in which case lateness is penalised).
4. Route duration ≤ driver shift limit.
5. Vehicle/driver eligibility: AVAILABLE, depot assigned, no active trip, no expired RC/insurance/PUC/fitness/permit, driver licence valid at plan start.
6. Closed road segments are not used; unreachable legs are infeasible (no silent fallback).

Orders that cannot be placed are returned in `unserved` with a reason (exceeds all capacities / no road path / cannot meet window or shift even alone / no remaining capacity or time). An **independent validator** (`validate.ts`) re-simulates every route from the raw input; `feasible` is true only if it reports zero violations.

### Objective (configurable weights, minimised)

```
J = w_time·hours + w_distance·km + w_cost·(fuel cost + driver cost)
  + w_emissions·kg CO₂ (estimated) + w_lateness·late minutes + w_risk·(km × vehicle risk)
  + Σ unserved penalty × priority multiplier (LOW 0.5, NORMAL 1, HIGH 2, URGENT 4)
```

Defaults: time 100/h, distance 0, cost 1/₹, emissions 2/kg, lateness 10/min, risk 5, unserved penalty 20 000. The API returns the breakdown per term. Vehicle risk = 0.05 + 0.01 × age (max 0.2) + 0.1 if a document expires within the alert window.

### Distances and times

- With a company road network: Dijkstra from each snapped node (closed edges removed); location ↔ node access legs use straight line × 1.2 at 25 km/h.
- Without one: straight line × 1.3 at 45 km/h, labelled `HAVERSINE_ESTIMATE`.
- Leg time = max(network time, distance / vehicle average speed).
- Fuel per leg = km / (mileage / (1 + loadPenalty × load/capacity)).

## Algorithms

| Id | Description |
|---|---|
| `GREEDY_INSERTION` | Baseline. Orders sorted by priority, then window end. Each pickup+drop pair is inserted at the cheapest feasible positions across all vehicles (O(n²) positions per route). Deterministic. |
| `LOCAL_SEARCH` | Baseline + repeated passes of (a) re-trying unserved orders and (b) best-improvement *relocate* (remove an order and re-insert it at its best position anywhere) and *exchange* (displace a served order so an unserved one fits, then try to re-insert the displaced order), each accepted only if J decreases. Stops at a local optimum or iteration budget. |
| `SIMULATED_ANNEALING` | Starts from the baseline. Each iteration removes a random served order and re-inserts it (into a random vehicle or anywhere) or tries an unserved order; Metropolis acceptance with geometric cooling from T₀ = 5 % of the mean route objective to T₀/1000. Best solution kept, then polished with local search. Seeded (mulberry32) → reproducible. |

This is a classical metaheuristic. No quantum computing, QPSO or GPU acceleration is used or claimed. GA/PSO/QPSO or an ApexCUDA adapter can be added behind the same `Instance → Solution` contract once compared fairly against this baseline.

## Reproducible benchmark

```powershell
npm run benchmark
npm --prefix backend run benchmark -- --sizes 10x3,25x5,50x8 --seeds 1,2,3 --iterations 400
```

Instances are **synthetic** (`optimizer/synthetic.ts`): random points in a ~45 km box, seeded orders and windows. Every algorithm gets the same instance, constraints, iteration budget and machine; the table reports feasibility, served orders, km, cost, CO₂, objective and runtime, plus CPU model and Node version. Do not present these numbers as real-world savings.

Example output from the development sandbox (Intel Xeon 2.8 GHz × 2, Node 22, 300 iterations, `--sizes 10x3,25x5,50x8 --seeds 1,2`):

| orders×vehicles | seed | algorithm | served | km | objective | runtime ms |
|---|---|---|---|---|---|---|
| 10×3 | 1 | GREEDY_INSERTION | 10/10 | 485.3 | 8 786 | 11 |
| 10×3 | 1 | LOCAL_SEARCH | 10/10 | 361.3 | 6 870 | 34 |
| 10×3 | 1 | SIMULATED_ANNEALING | 10/10 | 330.6 | 6 346 | 78 |
| 25×5 | 1 | GREEDY_INSERTION | 22/25 | 1 172.4 | 60 656 | 7 |
| 25×5 | 1 | LOCAL_SEARCH | 25/25 | 1 087.3 | 19 490 | 118 |
| 25×5 | 1 | SIMULATED_ANNEALING | 25/25 | 1 178.8 | 20 836 | 173 |
| 50×8 | 1 | GREEDY_INSERTION | 45/50 | 1 761.2 | 82 698 | 35 |
| 50×8 | 1 | LOCAL_SEARCH | 49/50 | 1 604.8 | 40 934 | 374 |
| 50×8 | 1 | SIMULATED_ANNEALING | 50/50 | 1 574.7 | 30 294 | 594 |
| 50×8 | 2 | LOCAL_SEARCH | 49/50 | 1 748.1 | 42 523 | 291 |
| 50×8 | 2 | SIMULATED_ANNEALING | 49/50 | 1 661.3 | 41 140 | 703 |

All plans were feasible. Simulated annealing is not always better than local search (25×5, seed 1) — compare per instance and seed rather than assuming.

## Tests

`backend/tests/unit/optimizer.test.ts` and `graph.test.ts` cover capacity, precedence, hard/soft windows, waiting for window start, shift limits, unreachable legs, invalid input rejection, validator detection of hand-made violations, determinism per seed, "improvers never worse than baseline", objective breakdown consistency, Dijkstra = A*, closed roads, one-way edges and disconnected graphs.
