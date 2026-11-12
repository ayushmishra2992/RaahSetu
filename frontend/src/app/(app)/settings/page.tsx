"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { FormShell } from "@/components/forms";
import { Alert, Card, Field, Input, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { humanize } from "@/lib/format";
import type { Settings } from "@/lib/types";

const FUELS = ["DIESEL", "PETROL", "CNG", "ELECTRIC"] as const;
const UNITS: Record<string, string> = { DIESEL: "L", PETROL: "L", CNG: "kg", ELECTRIC: "kWh" };

export default function SettingsPage() {
  const { me, can, refresh } = useAuth();
  const c = me.company;
  const [profile, setProfile] = useState({ name: c.name, gstNumber: c.gstNumber ?? "", address: c.address ?? "", city: c.city ?? "", state: c.state ?? "", phone: c.phone ?? "" });
  const [settings, setSettings] = useState<Settings>(c.settings);
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const [saved, setSaved] = useState<string | null>(null);
  const admin = can("company:manage");
  const num = (v: string) => (v === "" ? 0 : Number(v));

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" subtitle="Company profile, GreenFleet assumptions and your password." />
      {saved && <Alert kind="success">{saved}</Alert>}
      {admin ? (
        <>
          <Card title="Company profile">
            <FormShell submitLabel="Save profile" onSubmit={async () => { await api("/company", { method: "PATCH", body: profile }); await refresh(); setSaved("Company profile saved."); }}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {(Object.keys(profile) as Array<keyof typeof profile>).map((k) => (
                  <Field key={k} label={k === "gstNumber" ? "GSTIN" : humanize(k)}><Input value={profile[k]} onChange={(e) => setProfile((p) => ({ ...p, [k]: e.target.value }))} required={k === "name"} /></Field>
                ))}
              </div>
            </FormShell>
          </Card>
          <Card title="GreenFleet & cost assumptions">
            <FormShell submitLabel="Save assumptions" onSubmit={async () => { await api("/company", { method: "PATCH", body: { settings } }); await refresh(); setSaved("Assumptions saved. New estimates and plans will use them."); }}>
              <p className="text-sm text-muted">These are the factors behind every fuel, cost and CO₂ estimate. Defaults are placeholders — set your actual prices and verify emission factors for formal reporting.</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                {FUELS.map((f) => (
                  <Field key={`p${f}`} label={`${humanize(f)} price (₹/${UNITS[f]})`}><Input type="number" step="any" min={0} value={settings.fuelPricePerUnit[f]} onChange={(e) => setSettings((s) => ({ ...s, fuelPricePerUnit: { ...s.fuelPricePerUnit, [f]: num(e.target.value) } }))} /></Field>
                ))}
                {FUELS.map((f) => (
                  <Field key={`e${f}`} label={`${humanize(f)} kg CO₂/${UNITS[f]}`}><Input type="number" step="any" min={0} value={settings.emissionKgPerUnit[f]} onChange={(e) => setSettings((s) => ({ ...s, emissionKgPerUnit: { ...s.emissionKgPerUnit, [f]: num(e.target.value) } }))} /></Field>
                ))}
                <Field label="Load penalty at full load" hint="0.2 = 20% more fuel/km when full"><Input type="number" step="0.01" min={0} max={2} value={settings.loadPenaltyAtFullLoad} onChange={(e) => setSettings((s) => ({ ...s, loadPenaltyAtFullLoad: num(e.target.value) }))} /></Field>
                <Field label="Driver cost (₹/hour)"><Input type="number" step="any" min={0} value={settings.driverCostPerHour} onChange={(e) => setSettings((s) => ({ ...s, driverCostPerHour: num(e.target.value) }))} /></Field>
                <Field label="Document alert window (days)"><Input type="number" min={1} max={365} value={settings.documentExpiryAlertDays} onChange={(e) => setSettings((s) => ({ ...s, documentExpiryAlertDays: num(e.target.value) }))} /></Field>
              </div>
              <h3 className="text-sm font-semibold">Default OptiRoute weights</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
                {(Object.keys(settings.defaultWeights) as Array<keyof Settings["defaultWeights"]>).map((k) => (
                  <Field key={k} label={humanize(k)}><Input type="number" step="any" min={0} value={settings.defaultWeights[k]} onChange={(e) => setSettings((s) => ({ ...s, defaultWeights: { ...s.defaultWeights, [k]: num(e.target.value) } }))} /></Field>
                ))}
              </div>
            </FormShell>
          </Card>
        </>
      ) : (
        <Alert kind="info">Only company admins can change company settings.</Alert>
      )}
      <Card title="Change your password">
        <FormShell submitLabel="Change password" onSubmit={async () => { await api("/auth/change-password", { body: pw }); setPw({ currentPassword: "", newPassword: "" }); setSaved("Password changed."); }}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Current password"><Input type="password" autoComplete="current-password" required value={pw.currentPassword} onChange={(e) => setPw((p) => ({ ...p, currentPassword: e.target.value }))} /></Field>
            <Field label="New password" hint="8+ characters with a letter and a number"><Input type="password" autoComplete="new-password" required value={pw.newPassword} onChange={(e) => setPw((p) => ({ ...p, newPassword: e.target.value }))} /></Field>
          </div>
        </FormShell>
      </Card>
    </div>
  );
}
