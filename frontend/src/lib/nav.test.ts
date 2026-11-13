import { describe, expect, it } from "vitest";
import { breadcrumbsFor, isActive, NAV, requiredPermission, visibleNav } from "./nav";

const allow = (perms: string[]) => (p: string) => perms.includes(p);

describe("navigation", () => {
  it("keeps every route and permission the previous sidebar had", () => {
    const flat = NAV.flatMap((g) => g.items.map((i) => `${i.href}|${i.permission ?? ""}`));
    expect(flat).toEqual([
      "/dashboard|dashboard:read",
      "/orders|orders:read",
      "/trips|trips:read",
      "/optiroute|optimize:read",
      "/scenarios|optimize:read",
      "/vehicles|fleet:read",
      "/drivers|fleet:read",
      "/documents|documents:read",
      "/locations|locations:read",
      "/greenfleet|greenfleet:read",
      "/billing|billing:read",
      "/users|users:manage",
      "/audit|audit:read",
      "/settings|",
    ]);
  });

  it("filters items by permission and drops empty groups", () => {
    // A driver can read trips and locations only.
    const groups = visibleNav(allow(["trips:read", "locations:read", "trips:progress"]));
    expect(groups.map((g) => g.group)).toEqual(["Operations", "Fleet", "Admin"]);
    expect(groups.flatMap((g) => g.items.map((i) => i.href))).toEqual(["/trips", "/locations", "/settings"]);
  });

  it("matches active sections by prefix without false positives", () => {
    expect(isActive("/trips/12", "/trips")).toBe(true);
    expect(isActive("/trips", "/trips")).toBe(true);
    expect(isActive("/tripsx", "/trips")).toBe(false);
  });

  it("builds breadcrumbs for sections and sub-pages", () => {
    expect(breadcrumbsFor("/orders")).toEqual([{ label: "Operations" }, { label: "Orders", href: "/orders" }]);
    expect(breadcrumbsFor("/trips/7")).toEqual([{ label: "Operations" }, { label: "Trips & Dispatch", href: "/trips" }, { label: "Trip details" }]);
    expect(breadcrumbsFor("/optiroute/runs/42").at(-1)).toEqual({ label: "Run #42" });
    expect(breadcrumbsFor("/billing/3").map((c) => c.label)).toEqual(["Business", "Invoices & Challans", "Document"]);
    expect(breadcrumbsFor("/unknown")).toEqual([{ label: "RaahSetu" }]);
  });
});

describe("requiredPermission", () => {
  it("uses the nav item's permission for the page and its sub-pages", () => {
    expect(requiredPermission("/billing")).toBe("billing:read");
    expect(requiredPermission("/billing/7")).toBe("billing:read");
    expect(requiredPermission("/users")).toBe("users:manage");
    expect(requiredPermission("/optiroute/runs/3")).toBe("optimize:read");
  });
  it("needs write access for manual trip creation", () => {
    expect(requiredPermission("/trips/new")).toBe("trips:write");
    expect(requiredPermission("/trips/5")).toBe("trips:read");
  });
  it("leaves settings and unknown paths open to any signed-in user", () => {
    expect(requiredPermission("/settings")).toBeUndefined();
    expect(requiredPermission("/design-system")).toBeUndefined();
  });
});
