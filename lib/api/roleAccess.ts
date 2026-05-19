type MembershipLike = {
  company_id?: string | null;
  role?: string | null;
};

const ELEVATED_ROLES = ["platform_owner", "owner", "admin"] as const;

export function normalizeRole(role: unknown) {
  return String(role || "").trim().toLowerCase();
}

export function normalizeRoles(roles: unknown[]) {
  return Array.from(
    new Set(roles.map((role) => normalizeRole(role)).filter(Boolean))
  );
}

export function rolesForCompany(
  memberships: MembershipLike[],
  companyId: string,
  includePlatformOwner = false
) {
  const roles = memberships
    .filter((membership) => membership.company_id === companyId)
    .map((membership) => membership.role);

  if (
    includePlatformOwner &&
    memberships.some((membership) => normalizeRole(membership.role) === "platform_owner")
  ) {
    roles.push("platform_owner");
  }

  return normalizeRoles(roles);
}

export function hasAnyRole(roles: string[], allowedRoles: readonly string[]) {
  const normalizedRoles = new Set(roles.map((role) => normalizeRole(role)));
  return allowedRoles.some((role) => normalizedRoles.has(normalizeRole(role)));
}

export function canViewFinance(roles: string[]) {
  return hasAnyRole(roles, [...ELEVATED_ROLES, "finance", "management"]);
}

export function canEditFinance(roles: string[]) {
  return hasAnyRole(roles, [...ELEVATED_ROLES, "finance"]);
}

export function canViewJourneys(roles: string[]) {
  return hasAnyRole(roles, [...ELEVATED_ROLES, "ops", "management", "finance"]);
}

export function canEditJourneys(roles: string[]) {
  return hasAnyRole(roles, [...ELEVATED_ROLES, "ops"]);
}

export function canViewFuel(roles: string[]) {
  return hasAnyRole(roles, [...ELEVATED_ROLES, "ops", "finance", "management"]);
}

export function canEditFuel(roles: string[]) {
  return hasAnyRole(roles, [...ELEVATED_ROLES, "ops", "finance"]);
}

export function canViewExpenses(roles: string[]) {
  return hasAnyRole(roles, [...ELEVATED_ROLES, "finance", "management"]);
}

export function canEditExpenses(roles: string[]) {
  return hasAnyRole(roles, [...ELEVATED_ROLES, "finance"]);
}
