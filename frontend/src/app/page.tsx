import Link from "next/link";

const modules = [
  ["Fleet & compliance", "Vehicles, drivers, RC/insurance/PUC/fitness/permit tracking with expiry alerts and private document storage."],
  ["Orders, trips & dispatch", "Pickup/drop orders with time windows, trip lifecycle with stop-level progress and a full status timeline."],
  ["OptiRoute", "Constrained multi-vehicle pickup & delivery routing: capacity, time windows, shift limits, eligibility and closed roads."],
  ["GreenFleet", "Transparent fuel, cost and CO₂ estimates with visible, editable assumptions — compared with your logged fuel."],
  ["Scenarios", "What-if re-planning for breakdowns, road closures, urgent orders and driver absence, with dispatcher approval."],
  ["Control Tower & QR", "Alerts, utilisation and live (simulated) trip progress; QR-verifiable invoices, challans and trip sheets."],
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-brand-600 text-sm font-bold text-white">RS</span>
          <span className="text-lg font-semibold tracking-tight">RaahSetu 2.0</span>
        </div>
        <nav className="flex gap-2 text-sm">
          <Link href="/login" className="rounded-md px-3 py-2 font-medium text-brand-700 hover:bg-brand-50">
            Log in
          </Link>
          <Link href="/register" className="rounded-md bg-brand-600 px-3 py-2 font-medium text-white hover:bg-brand-700">
            Register your company
          </Link>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-6 pb-20">
        <section className="grid grid-cols-1 gap-10 py-14 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">Smart transport & fleet operations</p>
            <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-tight text-ink sm:text-5xl">Plan feasible routes. Dispatch with confidence. See the trade-offs.</h1>
            <p className="mt-5 max-w-xl text-base text-muted">
              RaahSetu connects your vehicles, drivers, compliance documents, orders and trips in one place, and recommends which vehicle should serve which orders —
              without quietly breaking capacity, time-window or shift constraints.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/login" className="rounded-md bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700">
                Open the app
              </Link>
              <Link href="/register" className="rounded-md border border-line px-5 py-2.5 text-sm font-medium hover:bg-canvas">
                Start a new company
              </Link>
            </div>
          </div>
          <div className="rounded-xl border border-line bg-canvas p-6 text-sm">
            <p className="font-mono text-xs text-muted">OptiRoute objective</p>
            <p className="mt-2 font-mono text-[13px] leading-6 text-ink">
              J = w₁·time + w₂·distance + w₃·cost
              <br />+ w₄·CO₂(est.) + w₅·lateness + w₆·risk
              <br />+ penalty × unserved priority
            </p>
            <p className="mt-4 text-muted">Every plan is re-checked by an independent validator; infeasible plans are never marked feasible, and unserved orders come with a reason.</p>
          </div>
        </section>
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map(([t, d]) => (
            <div key={t} className="rounded-lg border border-line p-5">
              <h2 className="font-semibold text-ink">{t}</h2>
              <p className="mt-2 text-sm text-muted">{d}</p>
            </div>
          ))}
        </section>
        <p className="mt-10 text-xs text-muted">
          Fuel and emissions figures are estimates from configurable factors. Vehicle positions are simulated unless a telemetry provider is integrated. QR verification checks
          RaahSetu records only — it is not a government (e-way bill / VAHAN / GSTN) verification.
        </p>
      </main>
    </div>
  );
}
