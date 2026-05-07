import { supabase } from "../supabase";

export async function getContextPermissions(userEmail: string) {
  const { data: roleData, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("email", userEmail)
    .eq("is_active", true) // Ensures only active accounts get clearance
    .single();

  if (error || !roleData) {
    return {
      role: "VIEWER",
      canSeeRevenue: false,
      canSeeOps: true,
      canVerify: false,
      canSeeStrategy: false,
      isAdmin: false
    };
  }

  const role = roleData.role;

  return {
    role,

    // Revenue/Financial visibility
    canSeeRevenue: ["MANAGEMENT", "FINANCE", "SUPER_ADMIN"].includes(role),

    // Operational/Truck/Journey visibility
    canSeeOps: ["OPS", "MANAGEMENT", "FINANCE", "SUPER_ADMIN"].includes(role),

    // Ability to approve/reject financial documents
    canVerify: ["FINANCE", "SUPER_ADMIN"].includes(role),

    // High-level company strategy/leakage dashboards
    canSeeStrategy: ["MANAGEMENT", "SUPER_ADMIN"].includes(role),

    // Full system control
    isAdmin: role === "SUPER_ADMIN"
  };
}
