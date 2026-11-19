"use client";

import { Building2, KeyRound, Leaf, Route, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { CompliancePolicyForm } from "@/components/CompliancePolicyForm";
import { FormShell } from "@/components/forms";
import { Alert, Card, Field, Input, PageHeader, StatusBadge, Tabs, useToast } from "@/components/ds";
import { api } from "@/lib/api";
import { humanize } from "@/lib/format";
import type { Settings } from "@/lib/types";
import { passwordProblem } from "@/lib/validation";

const FUELS = ["DIESEL", "PETROL", "CNG", "ELECTRIC"] as const;
const UNITS: Record<string, string> = { DIESEL: "L", PETROL: "L", CNG: "kg", ELECTRIC: "kWh" };
const WEIGHT_HELP: Record<string, string> = { time: "per hour", distance: "per km", cost: "per ₹", emissions: "per kg CO₂", lateness: "per late minute", risk: "per km × risk" };

/** Mirrors backend CompanySettingsSchema limits. */
function settingsProblem(s: Settings): string | null {
  const nums = [...Object.values(s.fuelPricePerUnit), ...Object.values(s.emissionKgPerUnit), s.driverCostPerHour, ...Object.values(s.defaultWeights)];
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return "Prices, factors, costs and weights can't be negative.";
  if (s.loadPenaltyAtFullLoad < 0 || s.loadPenaltyAtFullLoad > 2) return "Load penalty must be between 0 and 2.";
  if (!Number.isInteger(s.documentExpiryAlertDays) || s.documentExpiryAlertDays < 1 || s.documentExpiryAlertDays > 365) return "The document alert window must be 1–365 whole days.";
  return null;
}

export default function SettingsPage() {
  const { me, can, refresh } = useAuth();
  const c = me.company;
  const admin = can("company:manage");
  const [tab, setTab] = useState(admin ? "company" : "account");
  const [profile, setProfile] = useState({ name: c.name, gstNumber: c.gstNumber ?? "", address: c.address ?? "", city: c.city ?? "", state: c.state ?? "", phone: c.phone ?? "" });
  const [settings, setSettings] = useState<Settings>(c.settings);
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [pwError, setPwError] = useState<string | null>(null);
  const toast = useToast();
  const num = (v: string) => (v === "" ? 0 : Number(v));

  /** Sends only the keys of one section; the API merges them into the stored settings. */
  const saveSettings = async (keys: Array<keyof Settings>, successMessage: string) => {
    const p = settingsProblem(settings);
    if (p) throw new Error(p);
    const partial = Object.fromEntries(keys.map((k) => [k, settings[k]]));
    await api("/company", { method: "PATCH", body: { settings: partial } });
    await refresh();
    toast.success(successMessage);
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" subtitle="Company profile, the assumptions behind every estimate, OptiRoute defaults and your own password." meta={<StatusBadge status={me.user.role} label={`Signed in as ${humanize(me.user.role)}`} />} />
      {!admin && <Alert kind="info">Only company admins can change company settings. You can change your own password.</Alert>}
      <Tabs
        label="Settings sections"
        value={tab}
        onChange={setTab}
        tabs={[
          ...(admin
            ? [
                { id: "company", label: "Company" },
                { id: "estimates", label: "Costs & emissions" },
                { id: "optiroute", label: "OptiRoute defaults" },
                { id: "compliance", label: "Compliance" },
              ]
            : []),
          { id: "account", label: "Your account" },
        ]}
      />

      {admin && tab === "company" && (
        <Card title="Company profile" icon={Building2} description="Printed as the seller on invoices and challans">
          <FormShell
            submitLabel="Save profile"
            onSubmit={async () => {
              if (profile.name.trim().length < 2) throw new Error("Company name must be at least 2 characters.");
              const g = profile.gstNumber.trim().toUpperCase();
              if (g && !/^[0-9A-Z]{15}$/.test(g)) throw new Error("GSTIN must be 15 letters or digits.");
              await api("/company", { method: "PATCH", body: { ...profile, name: profile.name.trim(), gstNumber: g || null } });
              await refresh();
              toast.success("Company profile saved");
            }}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Company name" required>
                <Input required minLength={2} maxLength={120} value={profile.name} onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))} />
              </Field>
              <Field label="GSTIN" hint="15 characters; shown on invoices">
                <Input maxLength={15} className="uppercase" value={profile.gstNumber} onChange={(e) => setProfile((p) => ({ ...p, gstNumber: e.target.value.toUpperCase() }))} />
              </Field>
              <Field label="Phone">
                <Input type="tel" value={profile.phone} onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))} />
              </Field>
              <div className="sm:col-span-2 lg:col-span-3">
                <Field label="Address">
                  <Input value={profile.address} onChange={(e) => setProfile((p) => ({ ...p, address: e.target.value }))} />
                </Field>
              </div>
              <Field label="City">
                <Input value={profile.city} onChange={(e) => setProfile((p) => ({ ...p, city: e.target.value }))} />
              </Field>
              <Field label="State">
                <Input value={profile.state} onChange={(e) => setProfile((p) => ({ ...p, state: e.target.value }))} />
              </Field>
            </div>
          </FormShell>
        </Card>
      )}

      {admin && tab === "estimates" && (
        <Card title="Costs & emission factors" icon={Leaf} description="Used for every fuel, cost and CO₂ estimate in OptiRoute, trips and GreenFleet">
          <FormShell submitLabel="Save factors" onSubmit={() => saveSettings(["fuelPricePerUnit", "emissionKgPerUnit", "loadPenaltyAtFullLoad", "driverCostPerHour", "documentExpiryAlertDays"], "Factors saved. New estimates and plans use them; existing trips keep their estimates.")}>
            <p className="text-sm text-muted">Defaults are placeholders. Enter your actual fuel prices, and verify emission factors against an official source before using them for formal reporting.</p>
            <fieldset className="min-w-0">
              <legend className="mb-2 text-sm font-medium text-ink">Fuel and energy prices</legend>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {FUELS.map((f) => (
                  <Field key={`p${f}`} label={`${humanize(f)} (₹/${UNITS[f]})`}>
                    <Input type="number" step="any" min={0} value={settings.fuelPricePerUnit[f]} onChange={(e) => setSettings((s) => ({ ...s, fuelPricePerUnit: { ...s.fuelPricePerUnit, [f]: num(e.target.value) } }))} />
                  </Field>
                ))}
              </div>
            </fieldset>
            <fieldset className="min-w-0">
              <legend className="mb-2 text-sm font-medium text-ink">Emission factors</legend>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {FUELS.map((f) => (
                  <Field key={`e${f}`} label={`${humanize(f)} (kg CO₂/${UNITS[f]})`}>
                    <Input type="number" step="any" min={0} value={settings.emissionKgPerUnit[f]} onChange={(e) => setSettings((s) => ({ ...s, emissionKgPerUnit: { ...s.emissionKgPerUnit, [f]: num(e.target.value) } }))} />
                  </Field>
                ))}
              </div>
            </fieldset>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Load penalty at full load" hint="0.2 = 20% more fuel per km when full (0–2)">
                <Input type="number" step="0.01" min={0} max={2} value={settings.loadPenaltyAtFullLoad} onChange={(e) => setSettings((s) => ({ ...s, loadPenaltyAtFullLoad: num(e.target.value) }))} />
              </Field>
              <Field label="Driver cost (₹/hour)">
                <Input type="number" step="any" min={0} value={settings.driverCostPerHour} onChange={(e) => setSettings((s) => ({ ...s, driverCostPerHour: num(e.target.value) }))} />
              </Field>
              <Field label="Document alert window (days)" hint="“Expiring soon” threshold, 1–365">
                <Input type="number" min={1} max={365} step={1} value={settings.documentExpiryAlertDays} onChange={(e) => setSettings((s) => ({ ...s, documentExpiryAlertDays: num(e.target.value) }))} />
              </Field>
            </div>
          </FormShell>
        </Card>
      )}

      {admin && tab === "optiroute" && (
        <Card title="Default OptiRoute weights" icon={Route} description="Starting values for the objective in new plans; planners can still change them per run">
          <FormShell submitLabel="Save defaults" onSubmit={() => saveSettings(["defaultWeights"], "OptiRoute defaults saved")}>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              {(Object.keys(settings.defaultWeights) as Array<keyof Settings["defaultWeights"]>).map((k) => (
                <Field key={k} label={humanize(k)} hint={WEIGHT_HELP[k]}>
                  <Input type="number" step="any" min={0} value={settings.defaultWeights[k]} onChange={(e) => setSettings((s) => ({ ...s, defaultWeights: { ...s.defaultWeights, [k]: num(e.target.value) } }))} />
                </Field>
              ))}
            </div>
          </FormShell>
        </Card>
      )}

      {admin && tab === "compliance" && (
        <Card title="Compliance policy" icon={ShieldCheck} description="Which documents are required and when dispatch is blocked. Applies to OptiRoute, manual trips and dispatch.">
          <CompliancePolicyForm
            initial={c.settings.compliance}
            onSaved={async () => {
              await refresh();
              toast.success("Compliance policy saved");
            }}
          />
        </Card>
      )}

      {tab === "account" && (
        <Card title="Change your password" icon={KeyRound} description={`${me.user.name} · ${me.user.email}`}>
          <FormShell
            submitLabel="Change password"
            onSubmit={async () => {
              const p = passwordProblem(pw.newPassword) ?? (pw.newPassword !== pw.confirm ? "The new passwords don't match." : pw.newPassword === pw.currentPassword ? "Choose a password different from your current one." : null);
              setPwError(p);
              if (p) throw new Error(p);
              await api("/auth/change-password", { body: { currentPassword: pw.currentPassword, newPassword: pw.newPassword } });
              setPw({ currentPassword: "", newPassword: "", confirm: "" });
              toast.success("Password changed");
            }}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Current password" required>
                <Input type="password" autoComplete="current-password" required value={pw.currentPassword} onChange={(e) => setPw((p) => ({ ...p, currentPassword: e.target.value }))} />
              </Field>
              <Field label="New password" required hint="8+ characters with a letter and a number" error={pwError}>
                <Input type="password" autoComplete="new-password" required value={pw.newPassword} onChange={(e) => setPw((p) => ({ ...p, newPassword: e.target.value }))} />
              </Field>
              <Field label="Confirm new password" required>
                <Input type="password" autoComplete="new-password" required value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} />
              </Field>
            </div>
          </FormShell>
        </Card>
      )}
    </div>
  );
}
