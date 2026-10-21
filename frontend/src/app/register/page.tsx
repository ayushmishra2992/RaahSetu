"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ companyName: "", gstNumber: "", city: "", state: "", adminName: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/register-company", { body: form });
      router.replace("/dashboard");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-canvas px-4 py-10">
      <div className="w-full max-w-lg rounded-lg border border-line bg-white p-6">
        <h1 className="text-lg font-semibold">Register your company</h1>
        <p className="mt-1 text-sm text-muted">You will be the company administrator and can invite your team afterwards.</p>
        <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
          {error && (
            <div className="sm:col-span-2">
              <Alert>{error}</Alert>
            </div>
          )}
          <div className="sm:col-span-2">
            <Field label="Company name">
              <Input required value={form.companyName} onChange={set("companyName")} />
            </Field>
          </div>
          <Field label="GSTIN (optional)" hint="15 characters">
            <Input value={form.gstNumber} onChange={set("gstNumber")} maxLength={15} />
          </Field>
          <Field label="City">
            <Input value={form.city} onChange={set("city")} />
          </Field>
          <Field label="State">
            <Input value={form.state} onChange={set("state")} />
          </Field>
          <Field label="Your name">
            <Input required value={form.adminName} onChange={set("adminName")} />
          </Field>
          <Field label="Work email">
            <Input type="email" required autoComplete="email" value={form.email} onChange={set("email")} />
          </Field>
          <Field label="Password" hint="8+ characters with a letter and a number">
            <Input type="password" required autoComplete="new-password" value={form.password} onChange={set("password")} />
          </Field>
          <div className="sm:col-span-2 flex items-center justify-between">
            <Link href="/login" className="text-sm text-brand-700">
              Already registered? Log in
            </Link>
            <Button type="submit" loading={busy}>
              Create company
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
