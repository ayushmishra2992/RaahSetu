"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { DriverForm } from "@/components/forms";
import { Badge, Button, ErrorState, Loading, Modal, PageHeader, StatusBadge, Table, Td } from "@/components/ui";
import { daysUntil, fmtDate } from "@/lib/format";
import type { Driver } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export default function DriversPage() {
  const { can } = useAuth();
  const { data, error, loading, reload } = useApi<Driver[]>("/drivers");
  const [creating, setCreating] = useState(false);
  return (
    <div>
      <PageHeader title="Drivers" subtitle="Licences, availability and shift limits used by OptiRoute." actions={can("fleet:write") && <Button onClick={() => setCreating(true)}>Add driver</Button>} />
      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : (
        <Table head={["Name", "Phone", "Licence", "Licence expiry", "Shift limit", "App login", "Status"]} empty={data?.length === 0}>
          {data?.map((d) => {
            const days = daysUntil(d.licenseExpiry);
            return (
              <tr key={d.id} className="hover:bg-canvas">
                <Td><Link href={`/drivers/${d.id}`} className="font-medium text-brand-700">{d.name}</Link></Td>
                <Td>{d.phone}</Td>
                <Td>{d.licenseNumber}</Td>
                <Td>{fmtDate(d.licenseExpiry)} {days < 0 ? <Badge color="red">Expired</Badge> : days <= 30 ? <Badge color="amber">{days}d left</Badge> : null}</Td>
                <Td>{d.maxShiftHours} h</Td>
                <Td>{d.user?.email ?? "—"}</Td>
                <Td><StatusBadge status={d.status} /></Td>
              </tr>
            );
          })}
        </Table>
      )}
      <Modal open={creating} title="Add driver" onClose={() => setCreating(false)} wide>
        <DriverForm onSaved={() => { setCreating(false); reload(); }} />
      </Modal>
    </div>
  );
}
