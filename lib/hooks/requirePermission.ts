import { getContextPermissions } from "./usePermissions";

export async function requirePermission(
  userEmail: string,
  required: "admin" | "finance" | "management" | "ops"
) {
  const permissions = await getContextPermissions(userEmail);

  if (required === "admin" && !permissions.isAdmin) {
    return { allowed: false, permissions };
  }

  if (required === "finance" && !permissions.canVerify) {
    return { allowed: false, permissions };
  }

  if (required === "management" && !permissions.canSeeStrategy) {
    return { allowed: false, permissions };
  }

  if (required === "ops" && !permissions.canSeeOps) {
    return { allowed: false, permissions };
  }

  return { allowed: true, permissions };
}
