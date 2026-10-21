"use client";

import { useParams } from "next/navigation";
import { Badge, ErrorState, Loading } from "@/components/ui";
import { fmtDateTime, fmtMoney, humanize } from "@/lib/format";
import { useApi } from "@/lib/useApi";

interface Verification {
  valid: boolean;
  type: string;
  number: string;
  status: string;
  issuer: string;
  issuerGstin?: string | null;
  customerName?: string;
  total?: number | null;
  issuedAt?: string | null;
  createdAt?: string;
  vehicleRegistration?: string;
  driverName?: string;
  plannedStart?: string;
  stops?: number;
  disclaimer: string;
}

export default function VerifyPage() {
  const { token } = useParams<{ token: string }>();
  const { data, error, status, loading } = useApi<Verification>(`/public/verify/${encodeURIComponent(token)}`);

  return (
    <div className="grid min-h-screen place-items-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md rounded-lg border border-line bg-white p-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">RaahSetu verification</p>
        {loading && <Loading />}
        {error && (status === 404 ? <ErrorState message="No RaahSetu record matches this QR code. The document may be forged or mistyped." /> : <ErrorState message={error} />)}
        {data && (
          <>
            <div className="mt-3 flex items-center gap-2">
              <h1 className="text-lg font-semibold">{humanize(data.type)} {data.number}</h1>
              <Badge color={data.valid ? "green" : "red"}>{data.valid ? "Genuine record" : "Cancelled"}</Badge>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted">Issued by</dt>
              <dd>{data.issuer}{data.issuerGstin ? ` (${data.issuerGstin})` : ""}</dd>
              <dt className="text-muted">Status</dt>
              <dd>{humanize(data.status)}</dd>
              {data.customerName && (<><dt className="text-muted">Customer</dt><dd>{data.customerName}</dd></>)}
              {data.total != null && (<><dt className="text-muted">Total</dt><dd>{fmtMoney(data.total)}</dd></>)}
              {data.issuedAt && (<><dt className="text-muted">Issued at</dt><dd>{fmtDateTime(data.issuedAt)}</dd></>)}
              {data.vehicleRegistration && (<><dt className="text-muted">Vehicle</dt><dd>{data.vehicleRegistration}</dd></>)}
              {data.driverName && (<><dt className="text-muted">Driver</dt><dd>{data.driverName}</dd></>)}
              {data.plannedStart && (<><dt className="text-muted">Planned start</dt><dd>{fmtDateTime(data.plannedStart)}</dd></>)}
            </dl>
            <p className="mt-5 rounded-md bg-canvas px-3 py-2 text-xs text-muted">{data.disclaimer}</p>
          </>
        )}
      </div>
    </div>
  );
}
