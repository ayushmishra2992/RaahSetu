import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center p-6 text-center">
      <div className="max-w-sm">
        <p className="text-sm font-semibold text-brand-600">404</p>
        <h1 className="mt-1 text-xl font-semibold text-ink">Page not found</h1>
        <p className="mt-1 text-sm text-muted">The link may be mistyped, or the record may belong to another company or have been removed.</p>
        <Link href="/dashboard" className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">
          Go to the Control Tower
        </Link>
      </div>
    </main>
  );
}
