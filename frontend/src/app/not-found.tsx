import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center p-6 text-center">
      <div>
        <p className="text-sm font-semibold text-brand-600">404</p>
        <h1 className="mt-1 text-xl font-semibold">Page not found</h1>
        <Link href="/dashboard" className="mt-4 inline-block text-sm font-medium text-brand-700">
          Go to the Control Tower
        </Link>
      </div>
    </div>
  );
}
