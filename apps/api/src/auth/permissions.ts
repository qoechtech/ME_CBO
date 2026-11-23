import type { Role } from "@prisma/client";

export type Permission =
  | "events:read" | "events:create" | "events:update" | "events:delete"
  | "events:checkin" | "events:proof:verify"
  | "impact:read" | "impact:read:all" | "impact:log" | "impact:certificate:issue"
  | "members:read" | "members:approve" | "members:create" | "members:manage"
  | "inventory:read" | "inventory:checkout" | "inventory:approve"
  | "incidents:read" | "incidents:create" | "incidents:resolve"
  | "swap:read" | "swap:create"
  | "learning:read" | "learning:manage"
  | "finance:read" | "finance:manage" | "finance:approve" | "donations:read"
  | "admin:users:manage" | "admin:roles:manage" | "admin:audit:read" | "admin:settings:manage"
  | "petitions:manage";

const ROLES: Record<Role, Permission[]> = {
  SUPER_ADMIN: [
    "events:read","events:create","events:update","events:delete","events:checkin","events:proof:verify",
    "impact:read","impact:read:all","impact:log","impact:certificate:issue",
    "members:read","members:approve","members:create","members:manage",
    "inventory:read","inventory:checkout","inventory:approve",
    "incidents:read","incidents:create","incidents:resolve",
    "swap:read","swap:create","learning:read","learning:manage",
    "finance:read","finance:manage","finance:approve","donations:read",
    "admin:users:manage","admin:roles:manage","admin:audit:read","admin:settings:manage",
    "petitions:manage",
  ],
  OPERATIONS_ADMIN: [
    "events:read","events:create","events:update","events:delete","events:checkin","events:proof:verify",
    "impact:read","impact:read:all","impact:certificate:issue",
    "members:read","members:approve","members:create",
    "inventory:read","incidents:read","incidents:create","incidents:resolve",
    "swap:read","learning:read","learning:manage","petitions:manage",
  ],
  FINANCE_ADMIN: [
    "events:read","impact:read","impact:read:all","members:read",
    "inventory:read","inventory:approve",
    "finance:read","finance:manage","finance:approve","donations:read",
  ],
  TEAM_LEAD: [
    "events:read","events:update","events:checkin","events:proof:verify",
    "impact:read","impact:log","members:read",
    "inventory:read","inventory:checkout",
    "incidents:read","incidents:create",
    "swap:read","learning:read",
  ],
  MEMBER: [
    "events:read","events:checkin","impact:read","impact:log",
    "members:read","inventory:read","incidents:create",
    "swap:read","swap:create","learning:read",
  ],
};

export function permissionsFor(role: Role | undefined | null): Permission[] {
  if (!role) return [];
  return ROLES[role] ?? [];
}
