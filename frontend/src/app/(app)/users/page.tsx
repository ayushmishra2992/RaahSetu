"use client";

import { ShieldCheck, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { FormShell } from "@/components/forms";
import { Alert, Badge, Button, Card, DataTable, ErrorState, Field, Input, ListCard, Modal, PageHeader, Select, TableSkeleton, Tabs, useConfirm, useToast, type Column } from "@/components/ds";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime, humanize } from "@/lib/format";
import type { Role } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { passwordProblem } from "@/lib/validation";

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
  ["ADMIN", "Everything, including users and company settings"],
  ["MANAGER", "Fleet, documents, billing, scenario approvals, audit log"],
  ["DISPATCHER", "Orders, trips, OptiRoute, scenarios, locations, fuel logs"],
  ["EMPLOYEE", "Read-only access to operations"],
  ["DRIVER", "Only their own trips, including stop updates"],
];

export default function UsersPage() {
  const { me } = useAuth();
  const { data, error, loading, reload } = useApi<User[]>("/users");
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ name: "", email: "", password: "", role: "DISPATCHER" });
  const [pwError, setPwError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [roleTab, setRoleTab] = useState("all");
  const confirm = useConfirm();
  const toast = useToast();
  const all = data ?? [];
  const rows = roleTab === "all" ? all : roleTab === "inactive" ? all.filter((u) => !u.isActive) : all.filter((u) => u.role === roleTab);
  const activeAdmins = all.filter((u) => u.role === "ADMIN" && u.isActive).length;

  async function patch(id: number, body: Record<string, unknown>, done: string) {
    setMsg(null);
    try {
      await api(`/users/${id}`, { method: "PATCH", body });
      toast.success(done);
      reload();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }

  const roleControl = (u: User) => (
    <Select
      aria-label={`Role of ${u.name}`}
      value={u.role}
      disabled={u.id === me.user.id}
      title={u.id === me.user.id ? "You can't change your own role" : undefined}
      onChange={async (e) => {
        const role = e.target.value as Role;
        const ok = await confirm({
          title: `Change ${u.name}’s role to ${humanize(role)}?`,
          description: `Their access changes on their next request. ${humanize(role)}: ${ROLES.find(([r]) => r === role)?.[1] ?? ""}.${u.driver && role !== "DRIVER" ? ` They are linked to driver ${u.driver.name}; driver app access stops.` : ""}`,
          confirmLabel: "Change role",
          tone: "primary",
        });
        if (ok) await patch(u.id, { role }, `${u.name} is now ${humanize(role)}`);
      }}
      className="w-36"
    >
      {ROLES.map(([r]) => (
        <option key={r} value={r}>{humanize(r)}</option>
      ))}
    </Select>
  );

  const activation = (u: User) =>
    u.id !== me.user.id && (
      <Button
        size="sm"
        variant="ghost"
        onClick={async () => {
          const ok = await confirm(
            u.isActive
              ? { title: `Deactivate ${u.name}?`, description: "They are signed out on their next request and can’t sign in until reactivated. Their history is kept.", confirmLabel: "Deactivate", tone: "danger" }
              : { title: `Reactivate ${u.name}?`, description: `They can sign in again with their existing password and the ${humanize(u.role)} role.`, confirmLabel: "Reactivate", tone: "primary" },
          );
          if (ok) await patch(u.id, { isActive: !u.isActive }, u.isActive ? `${u.name} deactivated` : `${u.name} reactivated`);
        }}
      >
        {u.isActive ? "Deactivate" : "Reactivate"}
      </Button>
    );

  const columns: Array<Column<User>> = [
    {
      key: "name",
      header: "Name",
      sortValue: (u) => u.name,
      cell: (u) => (
        <span className="font-medium text-ink">
          {u.name}
          {u.id === me.user.id && <span className="ml-1 text-xs font-normal text-muted">(you)</span>}
          <span className="block text-xs font-normal text-muted">{u.email}</span>
        </span>
      ),
    },
    { key: "role", header: "Role", sortValue: (u) => u.role, cell: roleControl },
    { key: "driver", header: "Driver profile", cell: (u) => (u.driver ? <Link className="text-brand-700 hover:underline" href={`/drivers/${u.driver.id}`}>{u.driver.name}</Link> : u.role === "DRIVER" ? <Badge color="amber">Not linked</Badge> : <span className="text-muted">—</span>), hideBelow: "lg" },
    { key: "login", header: "Last sign-in", sortValue: (u) => u.lastLoginAt, cell: (u) => <span className="whitespace-nowrap text-xs">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "Never"}</span>, hideBelow: "md" },
    { key: "status", header: "Status", sortValue: (u) => (u.isActive ? 0 : 1), cell: (u) => (u.isActive ? <Badge color="green" dot>Active</Badge> : <Badge dot>Deactivated</Badge>) },
    { key: "actions", header: <span className="sr-only">Actions</span>, cell: activation },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Users & roles"
        subtitle="Everyone here belongs to your company only. Permissions are checked by the server on every request."
        actions={
          <Button icon={UserPlus} onClick={() => setCreating(true)}>
            Add user
          </Button>
        }
      />
      {msg && <Alert title="Couldn't update the user">{msg}</Alert>}
      {activeAdmins === 1 && <Alert kind="info">There is one active admin. The last admin can’t be demoted or deactivated, so add a second admin before changing that account.</Alert>}
      <Tabs
        label="Filter users"
        value={roleTab}
        onChange={setRoleTab}
        tabs={[
          { id: "all", label: "All", count: all.length },
          ...ROLES.map(([r]) => ({ id: r, label: humanize(r), count: all.filter((u) => u.role === r).length })),
          { id: "inactive", label: "Deactivated", count: all.filter((u) => !u.isActive).length },
        ]}
      />
      {loading ? (
        <TableSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(u) => u.id}
          searchText={(u) => `${u.name} ${u.email} ${u.role}`}
          searchPlaceholder="Search name or email…"
          initialSort={{ key: "name", dir: "asc" }}
          caption="Users"
          mobileCard={(u) => (
            <ListCard
              title={
                <>
                  {u.name}
                  {u.id === me.user.id && <span className="ml-1 text-xs font-normal text-muted">(you)</span>}
                </>
              }
              status={u.isActive ? <Badge color="green" dot>Active</Badge> : <Badge dot>Deactivated</Badge>}
              subtitle={u.email}
              details={[
                ["Last sign-in", u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "Never"],
                ["Driver profile", u.driver?.name ?? "—"],
              ]}
              actions={
                <>
                  {roleControl(u)}
                  {activation(u)}
                </>
              }
            />
          )}
          empty={{ title: "No users match", icon: Users }}
        />
      )}

      <Card title="Roles" icon={ShieldCheck} description="What each role can do">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {ROLES.map(([r, d]) => (
            <div key={r}>
              <dt className="font-medium text-ink">{humanize(r)}</dt>
              <dd className="text-muted">{d}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Modal open={creating} title="Add user" onClose={() => setCreating(false)}>
        <FormShell
          submitLabel="Create user"
          onSubmit={async () => {
            const p = passwordProblem(f.password);
            setPwError(p);
            if (p) throw new Error(`Password: ${p}`);
            await api("/users", { body: { ...f, name: f.name.trim(), email: f.email.trim() } });
            setCreating(false);
            setF({ name: "", email: "", password: "", role: "DISPATCHER" });
            toast.success("User created", f.role === "DRIVER" ? "Link them to a driver from Drivers → Edit → App login." : undefined);
            reload();
          }}
        >
          <Field label="Name" required>
            <Input required minLength={2} value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} autoComplete="off" />
          </Field>
          <Field label="Email" required>
            <Input type="email" required value={f.email} onChange={(e) => setF((s) => ({ ...s, email: e.target.value }))} autoComplete="off" />
          </Field>
          <Field label="Initial password" required hint="8+ characters with a letter and a number. Share it privately and ask them to change it." error={pwError}>
            <Input type="password" required autoComplete="new-password" value={f.password} onChange={(e) => setF((s) => ({ ...s, password: e.target.value }))} />
          </Field>
          <Field label="Role">
            <Select value={f.role} onChange={(e) => setF((s) => ({ ...s, role: e.target.value }))}>
              {ROLES.map(([r, d]) => (
                <option key={r} value={r}>
                  {humanize(r)} — {d}
                </option>
              ))}
            </Select>
          </Field>
          {f.role === "DRIVER" && <p className="text-xs text-muted">After creating a driver user, link them on the driver’s profile (Drivers → Edit → App login) so they can update their own trips.</p>}
        </FormShell>
      </Modal>
    </div>
  );
}
