"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
const DEMO_PASSWORD = "Demo@1234";
const DEMO_USERS = [
  { role: "Dispatcher", email: "dispatcher@demo.raahsetu.local", hint: "Plan routes, dispatch trips" },
  { role: "Manager", email: "manager@demo.raahsetu.local", hint: "Approve scenarios, billing" },
  { role: "Driver", email: "driver@demo.raahsetu.local", hint: "Run own trips" },
  { role: "Admin", email: "admin@demo.raahsetu.local", hint: "Users & settings" },
];

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(loginEmail: string, loginPassword: string) {
    setBusy(true);
    setError(null);
    try {
      await api("/auth/login", { body: { email: loginEmail, password: loginPassword } });
      const next = params.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    await signIn(email, password);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {DEMO_MODE && (
        <div className="rounded-md border border-brand-100 bg-brand-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Try the demo — one click</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {DEMO_USERS.map((u) => (
              <button
                key={u.email}
                type="button"
                disabled={busy}
                onClick={() => signIn(u.email, DEMO_PASSWORD)}
                className="rounded-md border border-line bg-white px-2 py-1.5 text-left hover:border-brand-500 disabled:opacity-50"
              >
                <span className="block text-sm font-medium text-ink">{u.role}</span>
                <span className="block text-[11px] text-muted">{u.hint}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted">Demo data is synthetic and may be reset at any time.</p>
        </div>
      )}
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
        {!DEMO_MODE && <p className="mt-2 text-center text-xs text-muted">Local demo: run <code>npm run db:seed</code> and see README for development-only logins.</p>}
      </div>
    </div>
  );
}
