import { supabaseAdmin } from "../supabaseAdmin";
import { normalizeRole } from "./roleAccess";

const INVITABLE_ROLES = new Set(["owner", "admin", "ops", "finance", "management"]);

function normalizeEmail(value: any) {
  return String(value || "").trim().toLowerCase();
}

function isMissingInvitationTable(error: any) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "42P01" || message.includes("company_user_invitations");
}

export async function acceptPendingCompanyInvitationsForUser(user: {
  id?: string | null;
  email?: string | null;
}) {
  const userId = String(user?.id || "").trim();
  const email = normalizeEmail(user?.email);

  if (!userId || !email) {
    return { accepted: 0, skipped: true };
  }

  const { data: invitations, error } = await supabaseAdmin
    .from("company_user_invitations")
    .select("id, company_id, email, role, status, revoked_at, accepted_at, supabase_user_id")
    .eq("email", email)
    .eq("status", "pending")
    .is("revoked_at", null)
    .is("accepted_at", null)
    .order("invited_at", { ascending: true });

  if (error) {
    if (isMissingInvitationTable(error)) return { accepted: 0, skipped: true };
    throw error;
  }

  let accepted = 0;

  for (const invitation of invitations || []) {
    const role = normalizeRole(invitation.role);
    const inviteUserId = String(invitation.supabase_user_id || "").trim();

    if (!INVITABLE_ROLES.has(role)) continue;
    if (inviteUserId && inviteUserId !== userId) continue;

    const { data: existingMembership, error: existingError } = await supabaseAdmin
      .from("company_users")
      .select("company_id, user_id, role, is_active")
      .eq("company_id", invitation.company_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (existingError) throw existingError;

    if (existingMembership) {
      const { error: updateMembershipError } = await supabaseAdmin
        .from("company_users")
        .update({ role, is_active: true })
        .eq("company_id", invitation.company_id)
        .eq("user_id", userId);

      if (updateMembershipError) throw updateMembershipError;
    } else {
      const { error: insertMembershipError } = await supabaseAdmin
        .from("company_users")
        .insert({
          company_id: invitation.company_id,
          user_id: userId,
          role,
          is_active: true,
        });

      if (insertMembershipError) throw insertMembershipError;
    }

    const { error: invitationUpdateError } = await supabaseAdmin
      .from("company_user_invitations")
      .update({
        status: "accepted",
        accepted_by: userId,
        accepted_at: new Date().toISOString(),
        supabase_user_id: userId,
        invite_error: null,
      })
      .eq("id", invitation.id);

    if (invitationUpdateError) throw invitationUpdateError;
    accepted += 1;
  }

  return { accepted, skipped: false };
}
