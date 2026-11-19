import type { UserRole } from "../generated/prisma/enums";

/**
 * Role → permission matrix. Keep this the single source of truth; the
 * frontend fetches the caller's permissions from /api/auth/me.
 */
export const PERMISSIONS = {
  "company:manage": ["ADMIN"],
  "users:manage": ["ADMIN"],
  "fleet:read": ["ADMIN", "MANAGER", "DISPATCHER", "EMPLOYEE"],
  "fleet:write": ["ADMIN", "MANAGER"],
  "documents:read": ["ADMIN", "MANAGER", "DISPATCHER", "EMPLOYEE"],
  "documents:write": ["ADMIN", "MANAGER"],
  /** Mark uploaded vehicle/driver documents verified or rejected. */
  "documents:verify": ["ADMIN", "MANAGER"],
  /** Driver KYC fields (masked ID, consent, address, emergency contact). */
  "kyc:read": ["ADMIN", "MANAGER"],
  "kyc:write": ["ADMIN", "MANAGER"],
  /** E-Way Bills, lorry receipts, challans/PODs as trip paperwork. Drivers: own trips only (enforced in the module). */
  "shipments:read": ["ADMIN", "MANAGER", "DISPATCHER", "EMPLOYEE", "DRIVER"],
  "shipments:write": ["ADMIN", "MANAGER", "DISPATCHER"],
  /** Record proof of delivery. Drivers: own trips only (enforced in the module). */
  "pod:write": ["ADMIN", "MANAGER", "DISPATCHER", "DRIVER"],
  /** Resolve a DISPUTED proof of delivery (change its outcome after the fact). */
  "pod:resolve": ["ADMIN", "MANAGER"],
  "locations:read": ["ADMIN", "MANAGER", "DISPATCHER", "EMPLOYEE", "DRIVER"],
  "locations:write": ["ADMIN", "MANAGER", "DISPATCHER"],
  "orders:read": ["ADMIN", "MANAGER", "DISPATCHER", "EMPLOYEE"],
  "orders:write": ["ADMIN", "MANAGER", "DISPATCHER"],
  "trips:read": ["ADMIN", "MANAGER", "DISPATCHER", "EMPLOYEE", "DRIVER"],
  "trips:write": ["ADMIN", "MANAGER", "DISPATCHER"],
  /** Drivers may progress their *own* trips; enforced in the trip service. */
  "trips:progress": ["ADMIN", "MANAGER", "DISPATCHER", "DRIVER"],
  "optimize:run": ["ADMIN", "MANAGER", "DISPATCHER"],
  "optimize:read": ["ADMIN", "MANAGER", "DISPATCHER", "EMPLOYEE"],
  "scenarios:approve": ["ADMIN", "MANAGER"],
  "billing:read": ["ADMIN", "MANAGER", "DISPATCHER", "EMPLOYEE"],
  "billing:write": ["ADMIN", "MANAGER"],
  "greenfleet:read": ["ADMIN", "MANAGER", "DISPATCHER", "EMPLOYEE"],
  "fuel:write": ["ADMIN", "MANAGER", "DISPATCHER"],
  "audit:read": ["ADMIN", "MANAGER"],
  "dashboard:read": ["ADMIN", "MANAGER", "DISPATCHER", "EMPLOYEE"],
} as const satisfies Record<string, readonly UserRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: UserRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly UserRole[]).includes(role);
}

export function permissionsFor(role: UserRole): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p));
}
