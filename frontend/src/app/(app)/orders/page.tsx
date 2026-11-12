"use client";

import { Package, Pencil, Plus, Route } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  Alert,
  Button,
  ConfirmButton,
  DataTable,
  Drawer,
  ErrorState,
  LinkButton,
  Loading,
  Modal,
  PageHeader,
  Select,
  SkeletonText,
  StatusBadge,
  Tabs,
  TableSkeleton,
  useToast,
  type Column,
} from "@/components/ds";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime, fmtMoney, fmtNum, humanize, isPast } from "@/lib/format";
import type { Order } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { OrderForm } from "./OrderForm";

type OrderDetail = Order & { tripStops?: Array<{ id: number; type: string; trip: { id: number; tripNumber: string; status: string } }> };

const STATUSES = ["PENDING", "ASSIGNED", "IN_TRANSIT", "DELIVERED", "CANCELLED"] as const;
const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

function OrdersInner() {
  const { can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const write = can("orders:write");
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<Order | null>(null);
  const { data, error, loading, reload } = useApi<Order[]>("/orders");
  const toast = useToast();

  const creating = write && params.get("new") === "1";
  const openId = params.get("open");
  const setParam = (key: string, value: string | null) => {
    const q = new URLSearchParams(params.toString());
    if (value) q.set(key, value);
    else q.delete(key);
    const s = q.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };

  async function cancelOrder(o: Order) {
    try {
      await api(`/orders/${o.id}/cancel`, { method: "POST" });
      toast.success(`${o.orderNumber} cancelled`);
      reload();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }

  const all = data ?? [];
  const count = (s: string) => all.filter((o) => o.status === s).length;
  const rows = all.filter((o) => (status === "all" || o.status === status) && (!priority || o.priority === priority));

  const columns: Array<Column<Order>> = [
    {
      key: "order",
      header: "Order",
      sortValue: (o) => o.orderNumber,
      cell: (o) => (
        <button type="button" onClick={() => setParam("open", String(o.id))} className="whitespace-nowrap text-left font-medium text-brand-700 hover:underline">
          {o.orderNumber}
        </button>
      ),
    },
    { key: "customer", header: "Customer", sortValue: (o) => o.customerName, cell: (o) => <span className="block max-w-[14rem] truncate">{o.customerName}</span> },
    { key: "route", header: "Route", hideBelow: "md", cell: (o) => <span className="text-xs">{o.pickupLocation?.name} → {o.dropLocation?.name}</span> },
    { key: "kg", header: "Weight", align: "right", sortValue: (o) => o.weightKg, cell: (o) => fmtNum(o.weightKg, "kg"), hideBelow: "sm" },
    { key: "priority", header: "Priority", sortValue: (o) => PRIORITY_RANK[o.priority], cell: (o) => <StatusBadge status={o.priority} />, hideBelow: "sm" },
    {
      key: "window",
      header: "Deliver by",
      hideBelow: "lg",
      sortValue: (o) => o.windowEnd,
      cell: (o) => (
        <span className="whitespace-nowrap text-xs">
          {o.windowEnd ? fmtDateTime(o.windowEnd) : "Any time"}
          {o.status === "PENDING" && isPast(o.windowEnd) && <span className="block font-medium text-danger-700">Window passed</span>}
        </span>
      ),
    },
    { key: "status", header: "Status", sortValue: (o) => STATUSES.indexOf(o.status), cell: (o) => <StatusBadge status={o.status} /> },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      cell: (o) =>
        write && o.status === "PENDING" ? (
          <span className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEditing(o)} aria-label={`Edit ${o.orderNumber}`}>
              Edit
            </Button>
            <ConfirmButton size="sm" confirmLabel="Cancel order" title="Cancel order?" description={`${o.orderNumber} for ${o.customerName} will no longer be planned. The record is kept for history.`} onConfirm={() => cancelOrder(o)}>
              Cancel
            </ConfirmButton>
          </span>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Orders"
        subtitle="Pickup → delivery jobs. Pending orders are planned by OptiRoute or added to a trip manually; only pending orders can be edited or cancelled."
        actions={
          <>
            {can("optimize:run") && (
              <LinkButton href="/optiroute" variant="secondary" icon={Route}>
                Plan with OptiRoute
              </LinkButton>
            )}
            {write && (
              <Button icon={Plus} onClick={() => setParam("new", "1")}>
                New order
              </Button>
            )}
          </>
        }
      />
      {msg && (
        <div className="mb-3">
          <Alert title="Couldn't update the order">{msg}</Alert>
        </div>
      )}
      <div className="mb-3">
        <Tabs
          label="Filter orders by status"
          value={status}
          onChange={setStatus}
          tabs={[{ id: "all", label: "All", count: all.length }, ...STATUSES.map((s) => ({ id: s, label: humanize(s), count: count(s) }))]}
        />
      </div>
      {loading ? (
        <TableSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(o) => o.id}
          searchText={(o) => `${o.orderNumber} ${o.customerName} ${o.pickupLocation?.name} ${o.dropLocation?.name} ${o.customerPhone ?? ""}`}
          searchPlaceholder="Search orders, customers, locations…"
          toolbar={
            <Select aria-label="Filter by priority" value={priority} onChange={(e) => setPriority(e.target.value)} className="sm:w-44">
              <option value="">All priorities</option>
              {["URGENT", "HIGH", "NORMAL", "LOW"].map((p) => (
                <option key={p} value={p}>{humanize(p)}</option>
              ))}
            </Select>
          }
          initialSort={{ key: "order", dir: "desc" }}
          caption="Orders"
          empty={{
            title: all.length ? "No orders match these filters" : "No orders yet",
            icon: Package,
            description: all.length ? "Try another status or priority." : "Create an order to start planning deliveries.",
            action: write && !all.length ? <Button icon={Plus} onClick={() => setParam("new", "1")}>New order</Button> : undefined,
          }}
        />
      )}

      <Modal open={creating} title="New order" onClose={() => setParam("new", null)} wide>
        {creating && (
          <OrderForm
            onSaved={(id) => {
              setParam("new", null);
              toast.success("Order created");
              reload();
              if (id) setTimeout(() => setParam("open", String(id)), 0);
            }}
          />
        )}
      </Modal>
      <Modal open={!!editing} title={editing ? `Edit ${editing.orderNumber}` : "Edit order"} onClose={() => setEditing(null)} wide>
        {editing && (
          <OrderForm
            key={editing.id}
            order={editing}
            onSaved={() => {
              setEditing(null);
              toast.success("Order updated");
              reload();
            }}
          />
        )}
      </Modal>
      <OrderDrawer id={openId} onClose={() => setParam("open", null)} onEdit={(o) => {
          setParam("open", null);
          setEditing(o);
        }} canWrite={write} />
    </div>
  );
}

function OrderDrawer({ id, onClose, onEdit, canWrite }: { id: string | null; onClose: () => void; onEdit: (o: Order) => void; canWrite: boolean }) {
  const { data: o, error, loading, reload } = useApi<OrderDetail>(id ? `/orders/${id}` : null);
  const trips = o?.tripStops ? [...new Map(o.tripStops.map((s) => [s.trip.id, s.trip])).values()] : [];
  return (
    <Drawer open={!!id} onClose={onClose} title={o ? o.orderNumber : "Order"} side="right" width="w-[min(28rem,100vw)]">
      {loading || !id ? (
        <SkeletonText lines={8} />
      ) : error || !o ? (
        <ErrorState message={error ?? "Not found"} onRetry={reload} />
      ) : (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={o.status} />
            <StatusBadge status={o.priority} label={`${humanize(o.priority)} priority`} />
          </div>
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2">
            <Term label="Customer">{o.customerName}</Term>
            <Term label="Phone">{o.customerPhone ?? "—"}</Term>
            <Term label="Pickup">{o.pickupLocation?.name}</Term>
            <Term label="Drop">{o.dropLocation?.name}</Term>
            <Term label="Weight">{fmtNum(o.weightKg, "kg")}</Term>
            <Term label="Service time">{o.serviceMinutes} min</Term>
            <Term label="Ready at">{fmtDateTime(o.readyAt)}</Term>
            <Term label="Window">{o.windowStart || o.windowEnd ? `${fmtDateTime(o.windowStart)} – ${fmtDateTime(o.windowEnd)}` : "Any time"}</Term>
            <Term label="Declared value">{fmtMoney(o.declaredValue)}</Term>
            <Term label="Created">{fmtDateTime(o.createdAt)}</Term>
          </dl>
          {o.notes && <p className="whitespace-pre-wrap rounded-md bg-surface-muted p-3 text-muted">{o.notes}</p>}
          <section aria-labelledby="order-trips">
            <h3 id="order-trips" className="mb-2 font-medium text-ink">Trips</h3>
            {trips.length === 0 ? (
              <p className="text-muted">Not on any trip yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {trips.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2">
                    <Link href={`/trips/${t.id}`} className="font-medium text-brand-700 hover:underline">{t.tripNumber}</Link>
                    <StatusBadge status={t.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>
          {canWrite && o.status === "PENDING" && (
            <Button variant="secondary" icon={Pencil} onClick={() => onEdit(o)}>
              Edit order
            </Button>
          )}
        </div>
      )}
    </Drawer>
  );
}

function Term({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </>
  );
}

export default function OrdersPage() {
  return (
    <Suspense fallback={<Loading />}>
      <OrdersInner />
    </Suspense>
  );
}
