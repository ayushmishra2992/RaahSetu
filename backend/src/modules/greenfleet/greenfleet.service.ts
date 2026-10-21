/**
 * Observed efficiency from logged fuel fills (full-tank method): distance
 * between consecutive fills divided by the quantity of the later fill.
 * Returns null when fewer than two fills exist — never a fabricated value.
 */
export function observedEfficiency(records: Array<{ odometerKm: number; quantity: number; filledAt: Date }>): number | null {
  const sorted = [...records].sort((a, b) => a.filledAt.getTime() - b.filledAt.getTime());
  let km = 0;
  let qty = 0;
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i].odometerKm - sorted[i - 1].odometerKm;
    if (d <= 0) continue;
    km += d;
    qty += sorted[i].quantity;
  }
  return qty > 0 ? km / qty : null;
}
