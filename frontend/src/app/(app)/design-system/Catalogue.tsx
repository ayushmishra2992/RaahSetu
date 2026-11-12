"use client";

import { Download, Package, Plus, Settings, Trash2, Truck } from "lucide-react";
import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  Dialog,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  FilterBar,
  IconButton,
  Input,
  Loading,
  Menu,
  PageHeader,
  SearchInput,
  Select,
  Skeleton,
  Stat,
  StatusBadge,
  Switch,
  Tabs,
  Textarea,
  Tooltip,
  useConfirm,
  useToast,
} from "@/components/ds";

const SWATCHES: Array<[string, string[]]> = [
  ["Forest (brand, primary actions)", ["brand-50", "brand-100", "brand-300", "brand-500", "brand-600", "brand-700", "brand-900"]],
  ["Navy (structure)", ["navy-50", "navy-100", "navy-300", "navy-500", "navy-700", "navy-900", "navy-950"]],
  ["Teal accent · semantic", ["accent-400", "accent-500", "success-600", "warning-600", "danger-600", "info-600"]],
  ["Neutrals", ["canvas", "surface-muted", "line", "line-strong", "subtle", "muted", "ink"]],
];

/** Sample rows for the table demo only — this page is a component catalogue, not product data. */
const DEMO_ROWS = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, code: `DEMO-${String(i + 1).padStart(3, "0")}`, status: ["AVAILABLE", "ON_TRIP", "MAINTENANCE"][i % 3], value: (i * 37) % 100 }));

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card title={title}>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

export function Catalogue() {
  const toast = useToast();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [tab, setTab] = useState("overview");
  const [q, setQ] = useState("");
  const [on, setOn] = useState(true);

  return (
    <div className="space-y-6">
      <PageHeader title="Design system" subtitle="Development-only catalogue of RaahSetu components. Not shown in production builds." meta={<Badge color="amber">Dev only</Badge>} />

      <Section title="Colour tokens">
        {SWATCHES.map(([label, names]) => (
          <div key={label}>
            <p className="mb-2 text-xs font-medium text-muted">{label}</p>
            <div className="flex flex-wrap gap-2">
              {names.map((n) => (
                <div key={n} className="w-24">
                  <div className="h-10 rounded-md border border-line" style={{ background: `var(--color-${n})` }} />
                  <p className="mt-1 font-mono text-[11px] text-muted">{n}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Section>

      <Section title="Typography">
        <p className="text-[22px] font-semibold tracking-[-0.01em]">Page title · 22/600</p>
        <p className="text-base font-semibold">Section title · 16/600</p>
        <p className="text-sm font-semibold">Card title · 14/600</p>
        <p className="text-sm">Body text · 14/400 — Inter, self-hosted via next/font.</p>
        <p className="text-xs text-muted">Caption · 12/400 muted</p>
        <p className="tabular text-[22px] font-semibold">₹1,23,456 · 98.6% · 1,840 km</p>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button icon={Plus}>Primary</Button>
          <Button variant="secondary" icon={Download}>Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="subtle">Subtle</Button>
          <Button variant="danger" icon={Trash2}>Danger</Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Tooltip content="Icon buttons need a label">
            <IconButton icon={Settings} label="Settings" variant="secondary" />
          </Tooltip>
        </div>
      </Section>

      <Section title="Form controls">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Registration number" hint="As printed on the RC" required>
            <Input placeholder="MH04AB1234" />
          </Field>
          <Field label="Capacity (kg)" error="Must be greater than 0">
            <Input type="number" defaultValue={0} />
          </Field>
          <Field label="Fuel">
            <Select defaultValue="DIESEL">
              <option>DIESEL</option>
              <option>CNG</option>
            </Select>
          </Field>
          <Field label="Notes">
            <Textarea rows={2} />
          </Field>
          <Checkbox label="Hard delivery time windows" description="Plans never deliver late." defaultChecked />
          <Switch checked={on} onChange={setOn} label="Return to depot" description="Routes end at the home depot." />
        </div>
        <FilterBar actions={<Button variant="secondary" size="sm">Export</Button>}>
          <SearchInput value={q} onChange={setQ} placeholder="Search registration…" />
          <Select className="sm:w-48">
            <option>All statuses</option>
          </Select>
        </FilterBar>
      </Section>

      <Section title="Badges & alerts">
        <div className="flex flex-wrap gap-2">
          {["AVAILABLE", "ON_TRIP", "MAINTENANCE", "IN_TRANSIT", "EXPIRED", "EXPIRING_SOON", "DRAFT", "PAID"].map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
          <Badge color="teal">Teal</Badge>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Alert kind="success" title="Saved">Changes were applied.</Alert>
          <Alert kind="warning">PUC for MH04QA1002 expires in 6 days.</Alert>
          <Alert kind="info">Positions are simulated from the planned schedule.</Alert>
          <Alert kind="error" title="Couldn't save">Vehicle is on a trip.</Alert>
        </div>
      </Section>

      <Section title="Cards, stats & tabs">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Stat label" value="128" hint="Hint text" icon={Truck} />
          <Stat label="Currency" value="₹48,200" hint="Estimate" />
          <Stat label="Percent" value="92.3%" />
          <Stat label="Unit" value="1,840 km" />
        </div>
        <Tabs label="Example tabs" value={tab} onChange={setTab} tabs={[{ id: "overview", label: "Overview" }, { id: "docs", label: "Documents", count: 4 }, { id: "trips", label: "Trips", count: 12 }]} />
        <p className="text-sm text-muted">Selected tab: {tab} (arrow keys move between tabs)</p>
      </Section>

      <Section title="Data table (client-side search, sort, pagination)">
        <DataTable
          rows={DEMO_ROWS}
          rowKey={(r) => r.id}
          searchText={(r) => r.code}
          pageSize={5}
          columns={[
            { key: "code", header: "Code", cell: (r) => <span className="font-medium">{r.code}</span>, sortValue: (r) => r.code },
            { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} />, sortValue: (r) => r.status },
            { key: "value", header: "Value", align: "right", cell: (r) => r.value, sortValue: (r) => r.value, hideBelow: "sm" },
          ]}
        />
      </Section>

      <Section title="Loading, empty & error states">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-20" />
          </div>
          <EmptyState compact title="No vehicles yet" icon={Package} action={<Button size="sm" icon={Plus}>Add vehicle</Button>}>
            Add your first vehicle to start planning routes.
          </EmptyState>
          <ErrorState message="Cannot reach the RaahSetu API." onRetry={() => toast.info("Retry clicked")} />
        </div>
        <Loading label="Loading example…" />
      </Section>

      <Section title="Overlays & feedback">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setDialog(true)}>Open dialog</Button>
          <Button variant="secondary" onClick={() => setDrawer(true)}>Open drawer</Button>
          <Button variant="secondary" onClick={() => confirm({ title: "Delete this record?", description: "This can't be undone.", confirmLabel: "Delete" })}>Confirm (danger)</Button>
          <Button variant="secondary" onClick={() => confirm({ title: "Fails on confirm", confirmLabel: "Try", action: () => Promise.reject(new Error("Server said no")) })}>Confirm with failing action</Button>
          <Button variant="secondary" onClick={() => toast.success("Order created", "ORD-0042 is pending")}>Success toast</Button>
          <Button variant="secondary" onClick={() => toast.error("Couldn't dispatch", "Vehicle is in maintenance")}>Error toast</Button>
          <Menu
            label="Example menu"
            triggerClassName="inline-flex h-9 items-center rounded-md border border-line-strong bg-surface px-3.5 text-sm font-medium shadow-xs hover:bg-surface-muted"
            trigger="Menu ▾"
            items={[{ label: "Edit", icon: Settings, onSelect: () => toast.info("Edit") }, { kind: "separator" }, { label: "Delete", icon: Trash2, tone: "danger", onSelect: () => toast.info("Delete") }]}
          />
        </div>
      </Section>

      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Dialog title"
        description="Esc, the close button or the backdrop dismiss it; focus returns to the trigger."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(false)}>Cancel</Button>
            <Button onClick={() => setDialog(false)}>Save</Button>
          </>
        }
      >
        <Field label="Name">
          <Input />
        </Field>
      </Dialog>
      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Drawer title">
        <div className="space-y-3 p-5 text-sm text-muted">
          <p>Side sheet for detail panels and mobile navigation.</p>
          <Button variant="secondary" onClick={() => setDrawer(false)}>Close</Button>
        </div>
      </Drawer>
    </div>
  );
}
