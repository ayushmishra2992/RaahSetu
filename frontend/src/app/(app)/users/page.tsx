"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { FormShell } from "@/components/forms";
import { Alert, Badge, Button, ErrorState, Field, Input, Loading, Modal, PageHeader, Select, Table, Td } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime, humanize } from "@/lib/format";
import type { Role } from "@/lib/types";
import { useApi } from "@/lib/useApi";

interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
  driver: { id: number; name: string } | null;
}

const ROLES: Array<[Role, string]> = [
  ["ADMIN", "Everything, incl. users and company settings"],
  ["MANAGER", "Fleet, documents, billing, approvals"],
  ["DISPATCHER", "Orders, trips, OptiRoute, scenarios"],
  ["EMPLOYEE", "Read-only"],
  ["DRIVER", "Own trips only"],
];

export default function UsersPage() {
  const { me } = useAuth();
  const { data, error, loading, reload } = useApi<User[]>("/users");
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ name: "", email: "", password: "", role: "DISPATCHER" });
  const [msg, setMsg] = useState<string | null>(null);

  async function patch(id: number, body: Record<string, unknown>) {
    setMsg(null);
    try {
      await api(`/users/${id}`, { method: "PATCH", body });
      reload();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }

  return (
    <div>
      <PageHeader title="Users & roles" subtitle="Everyone belongs to your company only; access is checked on every request." actions={<Button onClick={() => setCreating(true)}>Add user</Button>} />
      {msg && <div className="mb-3"><Alert>{msg}</Alert></div>}
      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : (
        <Table head={["ID", "Name", "Email", "Role", "Driver profile", "Last login", "Status", ""]}>
          {data?.map((u) => (
            <tr key={u.id}>
              <Td className="text-muted">{u.id}</Td>
              <Td className="font-medium">{u.name}{u.id === me.user.id && <span className="ml-1 text-xs text-muted">(you)</span>}</Td>
              <Td>{u.email}</Td>
              <Td>
                <Select value={u.role} disabled={u.id === me.user.id} onChange={(e) => patch(u.id, { role: e.target.value })} className="w-36">
                  {ROLES.map(([r]) => <option key={r} value={r}>{humanize(r)}</option>)}
                </Select>
              </Td>
              <Td>{u.driver?.name ?? "—"}</Td>
              <Td className="text-xs">{fmtDateTime(u.lastLoginAt)}</Td>
              <Td>{u.isActive ? <Badge color="green">Active</Badge> : <Badge>Deactivated</Badge>}</Td>
              <Td>{u.id !== me.user.id && <Button variant="ghost" onClick={() => patch(u.id, { isActive: !u.isActive })}>{u.isActive ? "Deactivate" : "Reactivate"}</Button>}</Td>
            </tr>
          ))}
        </Table>
      )}
      <ul className="mt-4 space-y-1 text-xs text-muted">{ROLES.map(([r, d]) => <li key={r}><span className="font-medium text-ink">{humanize(r)}</span>: {d}</li>)}</ul>
      <Modal open={creating} title="Add user" onClose={() => setCreating(false)}>
        <FormShell submitLabel="Create user" onSubmit={async () => { await api("/users", { body: f }); setCreating(false); setF({ name: "", email: "", password: "", role: "DISPATCHER" }); reload(); }}>
          <Field label="Name"><Input required value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} /></Field>
          <Field label="Email"><Input type="email" required value={f.email} onChange={(e) => setF((s) => ({ ...s, email: e.target.value }))} /></Field>
          <Field label="Initial password" hint="8+ characters with a letter and a number; ask them to change it"><Input type="password" required value={f.password} onChange={(e) => setF((s) => ({ ...s, password: e.target.value }))} /></Field>
          <Field label="Role"><Select value={f.role} onChange={(e) => setF((s) => ({ ...s, role: e.target.value }))}>{ROLES.map(([r, d]) => <option key={r} value={r}>{humanize(r)} — {d}</option>)}</Select></Field>
          <p className="text-xs text-muted">For drivers: after creating a DRIVER user, link them on the driver&apos;s profile (Drivers → Edit → linked user id).</p>
        </FormShell>
      </Modal>
    </div>
  );
}
