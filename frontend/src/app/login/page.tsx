"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/login", { body: { email, password } });
      const next = params.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <Field label="Email">
        <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password">
        <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button type="submit" loading={busy} className="w-full">
        Log in
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="grid min-h-screen place-items-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-brand-600 text-sm font-bold text-white">RS</span>
          <span className="text-lg font-semibold">RaahSetu 2.0</span>
        </Link>
        <div className="rounded-lg border border-line bg-white p-6">
          <h1 className="mb-4 text-lg font-semibold">Log in</h1>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
        <p className="mt-4 text-center text-sm text-muted">
          New company?{" "}
          <Link href="/register" className="font-medium text-brand-700">
            Register here
          </Link>
        </p>
        <p className="mt-2 text-center text-xs text-muted">Local demo: run <code>npm run db:seed</code> and see README for development-only logins.</p>
      </div>
    </div>
  );
}
