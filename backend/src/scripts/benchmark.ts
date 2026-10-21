/**
 * Reproducible OptiRoute benchmark on SYNTHETIC instances.
 *   npm run benchmark                # default sizes
 *   npm run benchmark -- --iterations 800 --seeds 1,2,3
 * Same inputs, constraints, stopping rule and machine for every algorithm.
 * Do not quote these numbers as real-world savings.
 */
import os from "node:os";
import { solve } from "../optimizer/solver";
import { syntheticInstance } from "../optimizer/synthetic";
import type { Algorithm } from "../optimizer/types";

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const iterations = Number(arg("iterations", "400"));
const seeds = arg("seeds", "1,2,3").split(",").map(Number);
const sizes = arg("sizes", "10x3,25x5,50x8").split(",").map((s) => s.split("x").map(Number) as [number, number]);
const algorithms: Algorithm[] = ["GREEDY_INSERTION", "LOCAL_SEARCH", "SIMULATED_ANNEALING"];

console.log(`# OptiRoute benchmark (synthetic data)\n`);
console.log(`Machine: ${os.cpus()[0]?.model ?? "unknown"} × ${os.cpus().length}, Node ${process.version}, ${os.platform()}`);
console.log(`Iterations budget: ${iterations}; seeds: ${seeds.join(", ")}; hard time windows; return to depot.\n`);
console.log("| orders×vehicles | algorithm | seed | feasible | served | km | cost | CO₂ kg | objective | runtime ms |");
console.log("|---|---|---|---|---|---|---|---|---|---|");
for (const [orders, vehicles] of sizes) {
  for (const seed of seeds) {
    for (const algorithm of algorithms) {
      const inst = syntheticInstance({ orders, vehicles, seed, algorithm, maxIterations: iterations });
      const s = solve(inst);
      console.log(
        `| ${orders}×${vehicles} | ${algorithm} | ${seed} | ${s.feasible ? "yes" : "NO"} | ${s.totals.servedOrders}/${orders} | ${s.totals.distanceKm.toFixed(1)} | ${s.totals.operatingCost.toFixed(0)} | ${s.totals.co2Kg.toFixed(1)} | ${s.objective.total.toFixed(0)} | ${s.runtimeMs} |`,
      );
    }
  }
}
