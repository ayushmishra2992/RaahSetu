/**
 * Single source of truth for the app navigation: groups, items, icons and the
 * permission each item requires (same permission strings as /api/auth/me).
 * The sidebar, mobile drawer and breadcrumbs are all derived from this list.
 */
import {
  FlaskConical,
  IdCard,
  LayoutDashboard,
  Leaf,
  MapPinned,
  Navigation,
  Package,
  ReceiptText,
  Route,
  ScrollText,
  Settings,
  ShieldCheck,
  Truck,
  FileStack,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Required permission; omitted = every signed-in user. */
  permission?: string;
}
export interface NavGroup {
  group: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    group: "Operations",
    items: [
      { href: "/dashboard", label: "Control Tower", icon: LayoutDashboard, permission: "dashboard:read" },
      { href: "/orders", label: "Orders", icon: Package, permission: "orders:read" },
      { href: "/trips", label: "Trips & Dispatch", icon: Navigation, permission: "trips:read" },
      { href: "/transport-documents", label: "Transport Documents", icon: FileStack, permission: "shipments:read" },
      { href: "/optiroute", label: "OptiRoute", icon: Route, permission: "optimize:read" },
      { href: "/scenarios", label: "Scenarios", icon: FlaskConical, permission: "optimize:read" },
    ],
  },
  {
    group: "Fleet",
    items: [
      { href: "/vehicles", label: "Vehicles", icon: Truck, permission: "fleet:read" },
      { href: "/drivers", label: "Drivers", icon: IdCard, permission: "fleet:read" },
      { href: "/documents", label: "Compliance", icon: ShieldCheck, permission: "documents:read" },
      { href: "/locations", label: "Locations & Roads", icon: MapPinned, permission: "locations:read" },
    ],
  },
  {
    group: "Business",
    items: [
      { href: "/greenfleet", label: "GreenFleet", icon: Leaf, permission: "greenfleet:read" },
      { href: "/billing", label: "Invoices & Challans", icon: ReceiptText, permission: "billing:read" },
    ],
  },
  {
    group: "Admin",
    items: [
      { href: "/users", label: "Users", icon: Users, permission: "users:manage" },
      { href: "/audit", label: "Audit log", icon: ScrollText, permission: "audit:read" },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

/** Navigation filtered to what the user may open. Empty groups are dropped. */
export function visibleNav(can: (permission: string) => boolean): NavGroup[] {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.permission || can(i.permission)) })).filter((g) => g.items.length > 0);
}

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Pages that need more than their nav item's read permission. */
const EXTRA_PERMISSIONS: Array<[RegExp, string]> = [[/^\/trips\/new$/, "trips:write"]];

/**
 * Permission needed to open a path, from the same table as the sidebar.
 * The API enforces permissions on every request; this only lets the UI show a
 * clear "no access" page instead of a page that fails to load.
 */
export function requiredPermission(pathname: string): string | undefined {
  for (const [re, permission] of EXTRA_PERMISSIONS) if (re.test(pathname)) return permission;
  for (const g of NAV) for (const i of g.items) if (isActive(pathname, i.href)) return i.permission;
  return undefined;
}

export interface Crumb {
  label: string;
  href?: string;
}

/** Sub-pages below a nav item, matched against the path after the item's href. */
const SUB_PAGES: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^\/trips\/new$/, () => "New trip"],
  [/^\/trips\/(\d+)$/, () => "Trip details"],
  [/^\/optiroute\/runs\/(\d+)$/, (m) => `Run #${m[1]}`],
  [/^\/optiroute\/compare$/, () => "Compare runs"],
  [/^\/scenarios\/(\d+)$/, (m) => `Scenario #${m[1]}`],
  [/^\/vehicles\/(\d+)$/, () => "Vehicle details"],
  [/^\/drivers\/(\d+)$/, () => "Driver profile"],
  [/^\/billing\/(\d+)$/, () => "Document"],
  [/^\/transport-documents\/eway-bills\/(\d+)$/, () => "E-Way Bill"],
  [/^\/transport-documents\/lorry-receipts\/(\d+)$/, () => "Lorry receipt"],
];

/** Breadcrumb trail for a path: group › section › sub-page. */
export function breadcrumbsFor(pathname: string): Crumb[] {
  for (const g of NAV) {
    const item = g.items.find((i) => isActive(pathname, i.href));
    if (!item) continue;
    const crumbs: Crumb[] = [{ label: g.group }, { label: item.label, href: item.href }];
    if (pathname !== item.href) {
      const sub = SUB_PAGES.map(([re, label]) => {
        const m = pathname.match(re);
        return m ? label(m) : null;
      }).find(Boolean);
      crumbs.push({ label: sub ?? "Details" });
    }
    return crumbs;
  }
  if (pathname === "/design-system") return [{ label: "Developer" }, { label: "Design system" }];
  return [{ label: "RaahSetu" }];
}
