"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg p-10">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">{error.message}</p>
      <button onClick={reset} className="mt-4 rounded-md bg-brand-600 px-3 py-2 text-sm text-white">
        Try again
      </button>
    </div>
  );
}
