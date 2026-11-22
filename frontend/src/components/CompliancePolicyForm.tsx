"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import {
  DEFAULT_POLICY,
  policyProblem,
  POLICY_DRIVER_DOC_TYPES,
  POLICY_FUELS,
  POLICY_VEHICLE_DOC_TYPES,
  POLICY_VEHICLE_TYPES,
  toggleDriverRequirement,
  toggleExemption,
  toggleVehicleRequirement,
} from "@/lib/compliancePolicy";
import { docTypeLabel, humanize } from "@/lib/format";
import type { CompliancePolicy } from "@/lib/types";
import { FormShell } from "./forms";
import { Alert, Checkbox, Field, Input } from "./ds";

/**
 * Edits settings.compliance only. The API merges partial settings, so saving
 * here never touches fuel prices, weights or any other section.
 */
export function CompliancePolicyForm({ initial, onSaved }: { initial?: CompliancePolicy; onSaved: () => Promise<void> | void }) {
  const [p, setP] = useState<CompliancePolicy>(initial ?? DEFAULT_POLICY);
  const required = (t: string) => p.vehicleRequirements.find((r) => r.type === t);

  return (
    <FormShell
      submitLabel="Save compliance policy"
      onSubmit={async () => {
        const problem = policyProblem(p);
        if (problem) throw new Error(problem);
        await api("/company", { method: "PATCH", body: { settings: { compliance: p } } });
        await onSaved();
      }}
    >
      <Alert kind="info">
        Requirements differ by vehicle category, goods and state. These rules are your company&apos;s policy, not legal advice — check them with whoever handles your fleet compliance. An expired required document always blocks dispatch.
      </Alert>

      <fieldset className="min-w-0 space-y-2">
        <legend className="text-sm font-medium text-ink">Required vehicle documents</legend>
        <ul className="divide-y divide-line rounded-lg border border-line">
          {POLICY_VEHICLE_DOC_TYPES.map((t) => {
            const r = required(t);
            return (
              <li key={t} className="space-y-2 px-3 py-2.5">
                <Checkbox label={`${docTypeLabel(t)} required`} checked={!!r} onChange={(e) => setP((s) => toggleVehicleRequirement(s, t, e.target.checked))} />
                {r && (
                  <details className="pl-6 text-sm">
                    <summary className="cursor-pointer text-xs font-medium text-brand-700">
                      Exemptions{r.exemptFuelTypes.length + r.exemptVehicleTypes.length ? ` (${[...r.exemptFuelTypes, ...r.exemptVehicleTypes].map(humanize).join(", ")})` : ""}
                    </summary>
                    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
                      {POLICY_FUELS.map((f) => (
                        <Checkbox key={f} label={`Not for ${humanize(f).toLowerCase()}`} checked={r.exemptFuelTypes.includes(f)} onChange={(e) => setP((s) => toggleExemption(s, t, "exemptFuelTypes", f, e.target.checked))} />
                      ))}
                      {POLICY_VEHICLE_TYPES.map((v) => (
                        <Checkbox key={v} label={`Not for ${humanize(v).toLowerCase()}`} checked={r.exemptVehicleTypes.includes(v)} onChange={(e) => setP((s) => toggleExemption(s, t, "exemptVehicleTypes", v, e.target.checked))} />
                      ))}
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>

      <fieldset className="min-w-0 space-y-2">
        <legend className="text-sm font-medium text-ink">Required driver documents</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {POLICY_DRIVER_DOC_TYPES.map((t) => (
            <Checkbox key={t} label={docTypeLabel(t)} checked={p.driverRequirements.includes(t)} onChange={(e) => setP((s) => toggleDriverRequirement(s, t, e.target.checked))} />
          ))}
        </div>
        <p className="text-xs text-muted">The licence expiry on the driver record is always enforced, whether or not a copy is required.</p>
      </fieldset>

      <fieldset className="min-w-0 space-y-2">
        <legend className="text-sm font-medium text-ink">How strictly dispatch is blocked</legend>
        <Checkbox
          label="Block when a required document is missing"
          description="Otherwise a missing document is only flagged as a warning."
          checked={p.blockOnMissing}
          onChange={(e) => setP((s) => ({ ...s, blockOnMissing: e.target.checked }))}
        />
        <Checkbox
          label="Block until required documents are verified"
          description="An admin or manager must mark each uploaded document as verified."
          checked={p.blockOnUnverified}
          onChange={(e) => setP((s) => ({ ...s, blockOnUnverified: e.target.checked }))}
        />
        <Checkbox
          label="Block when an expected E-Way Bill is missing or expired"
          description="Otherwise it is only flagged on the trip."
          checked={p.blockOnMissingShipmentDocs}
          onChange={(e) => setP((s) => ({ ...s, blockOnMissingShipmentDocs: e.target.checked }))}
        />
      </fieldset>

      <fieldset className="min-w-0 space-y-2">
        <legend className="text-sm font-medium text-ink">E-Way Bill check</legend>
        <Checkbox
          label="Expect an E-Way Bill above a declared value"
          checked={p.ewayBillValueThreshold !== null}
          onChange={(e) => setP((s) => ({ ...s, ewayBillValueThreshold: e.target.checked ? 50000 : null }))}
        />
        {p.ewayBillValueThreshold !== null && (
          <Field label="Declared value threshold (₹)" hint="The general GST rule is ₹50,000; some states and goods differ" className="max-w-xs">
            <Input type="number" min={0} step={1} inputMode="numeric" value={p.ewayBillValueThreshold} onChange={(e) => setP((s) => ({ ...s, ewayBillValueThreshold: e.target.value === "" ? 0 : Number(e.target.value) }))} />
          </Field>
        )}
      </fieldset>
    </FormShell>
  );
}
