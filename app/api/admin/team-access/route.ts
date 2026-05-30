import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { normalizeRole } from "../../../../lib/api/roleAccess";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const COMPANY_SELECT = "id, name, slug";
const MEMBERSHIP_SELECT = "company_id, user_id, role, is_active";
const INVITATION_SELECT =
  "id, company_id, email, role, status, invited_by, invited_at, accepted_by, accepted_at, revoked_at, revoked_by, supabase_user_id, invite_error, created_at, updated_at";
const PILOT_ROLES = new Set(["owner", "admin", "ops", "finance", "management"]);
const TENANT_ADMIN_ROLES = new Set(["owner", "admin"]);
const INTERNAL_ROLES = new Set(["platform_owner"]);

type ResolvedAccess = {
  user: any;
  company: any;
  memberships: any[];
  isPlatformOwner: boolean;
};

function noStoreJson(body: any, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      "Cache-Control": "no-store",
    },
  });
}

function normalizeEmail(value: any) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeTeamRole(value: any) {
  const role = normalizeRole(value);
  return PILOT_ROLES.has(role) ? role : "";
}

function isTenantAdminRole(role: any) {
  return TENANT_ADMIN_ROLES.has(normalizeRole(role));
}

function isInternalRole(role: any) {
  return INTERNAL_ROLES.has(normalizeRole(role));
}

function safeCompany(company: any) {
  return {
    id: company.id,
    name: company.name,
    slug: company.slug,
  };
}

function getActorCompanyRole(resolved: ResolvedAccess) {
  if (resolved.isPlatformOwner) return "platform_owner";
  return normalizeRole(
    resolved.memberships.find(
      (membership) => membership.company_id === resolved.company.id
    )?.role
  );
}

function canGrantRole(resolved: ResolvedAccess, role: string) {
  const nextRole = normalizeTeamRole(role);
  if (!nextRole) return false;
  if (resolved.isPlatformOwner) return true;

  const actorRole = getActorCompanyRole(resolved);
  if (actorRole === "owner") return true;
  if (actorRole === "admin") return nextRole !== "owner";
  return false;
}

function buildInviteRedirectTo(req: Request) {
  const configuredSiteUrl = String(process.env.NEXT_PUBLIC_SITE_URL || "").trim();
  const origin = configuredSiteUrl || new URL(req.url).origin;
  return `${origin.replace(/\/+$/, "")}/login`;
}

function safeInvitation(invitation: any) {
  return {
    id: invitation.id,
    email: invitation.email,
    role: normalizeRole(invitation.role),
    status: invitation.status || "pending",
    invited_at: invitation.invited_at || invitation.created_at || null,
    accepted_at: invitation.accepted_at || null,
    revoked_at: invitation.revoked_at || null,
    invite_error: invitation.invite_error ? "Invitation email could not be sent." : null,
  };
}

function safeInviteFailureMessage(error: any) {
  const text = String(error?.message || "").toLowerCase();
  if (text.includes("rate") || text.includes("limit")) {
    return "Invitation could not be sent right now because the email service is rate-limited. Try again shortly.";
  }
  if (text.includes("redirect")) {
    return "Invitation could not be sent because the sign-in redirect URL is not allowed yet.";
  }
  if (text.includes("email")) {
    return "Invitation could not be sent to that email address.";
  }
  return "Invitation could not be sent. Check Team Access setup and try again.";
}

async function authenticate(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return {
      error: noStoreJson({ success: false, error: "Unauthorized" }, { status: 401 }),
    };
  }

  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return {
      error: noStoreJson({ success: false, error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { user };
}

async function resolveAccess(req: Request, requestedCompanyId?: string | null) {
  const auth = await authenticate(req);
  if (auth.error) return auth;

  const { data: memberships, error: membershipError } = await supabaseAdmin
    .from("company_users")
    .select(MEMBERSHIP_SELECT)
    .eq("user_id", auth.user.id)
    .eq("is_active", true);

  if (membershipError) throw membershipError;

  const activeMemberships = memberships || [];
  const isPlatformOwner = activeMemberships.some(
    (membership) => normalizeRole(membership.role) === "platform_owner"
  );

  let companyId = String(requestedCompanyId || "").trim();
  if (!companyId && !isPlatformOwner) {
    companyId =
      activeMemberships.find((membership) => isTenantAdminRole(membership.role))
        ?.company_id || "";
  }

  if (!companyId) {
    return {
      error: noStoreJson(
        {
          success: false,
          error: "Choose a company before managing Team Access.",
        },
        { status: 400 }
      ),
    };
  }

  const canManageCompany =
    isPlatformOwner ||
    activeMemberships.some(
      (membership) =>
        membership.company_id === companyId && isTenantAdminRole(membership.role)
    );

  if (!canManageCompany) {
    return {
      error: noStoreJson(
        { success: false, error: "Owner or admin access required" },
        { status: 403 }
      ),
    };
  }

  const { data: company, error: companyError } = await supabaseAdmin
    .from("companies")
    .select(COMPANY_SELECT)
    .eq("id", companyId)
    .maybeSingle();

  if (companyError) throw companyError;
  if (!company) {
    return {
      error: noStoreJson(
        { success: false, error: "Company not found" },
        { status: 404 }
      ),
    };
  }

  return {
    user: auth.user,
    company,
    memberships: activeMemberships,
    isPlatformOwner,
  } satisfies ResolvedAccess;
}

async function listAuthUsersById() {
  const usersById = new Map<string, any>();

  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });

    if (error) {
      return { usersById, error };
    }

    const users = data?.users || [];
    for (const user of users) {
      usersById.set(user.id, user);
    }

    if (users.length < 1000) break;
  }

  return { usersById, error: null };
}

function safeUserSummary(authUser: any) {
  const metadata = authUser?.user_metadata || {};
  return {
    email: authUser?.email || null,
    full_name:
      metadata.full_name ||
      metadata.name ||
      metadata.display_name ||
      authUser?.email ||
      null,
    account_created_at: authUser?.created_at || null,
    last_sign_in_at: authUser?.last_sign_in_at || null,
  };
}

async function findAuthUserByEmail(email: string) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });

    if (error) throw error;

    const users = data?.users || [];
    const match = users.find((user) => normalizeEmail(user.email) === email);
    if (match) return match;
    if (users.length < 1000) break;
  }

  return null;
}

async function userHasInternalAccess(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("company_users")
    .select("role, is_active")
    .eq("user_id", userId)
    .eq("is_active", true);

  if (error) throw error;
  return (data || []).some((membership) => isInternalRole(membership.role));
}

async function markPendingInvitationsAccepted(input: {
  companyId: string;
  email: string;
  userId: string;
}) {
  await supabaseAdmin
    .from("company_user_invitations")
    .update({
      status: "accepted",
      accepted_by: input.userId,
      accepted_at: new Date().toISOString(),
      supabase_user_id: input.userId,
      invite_error: null,
    })
    .eq("company_id", input.companyId)
    .eq("email", input.email)
    .in("status", ["pending", "failed"])
    .is("accepted_at", null)
    .is("revoked_at", null);
}

async function findReusableInvitation(companyId: string, email: string) {
  const { data, error } = await supabaseAdmin
    .from("company_user_invitations")
    .select(INVITATION_SELECT)
    .eq("company_id", companyId)
    .eq("email", email)
    .in("status", ["pending", "failed"])
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("invited_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function createOrUpdatePendingInvitation(input: {
  companyId: string;
  email: string;
  role: string;
  invitedBy: string;
}) {
  const existing = await findReusableInvitation(input.companyId, input.email);
  const values = {
    company_id: input.companyId,
    email: input.email,
    role: input.role,
    status: "pending",
    invited_by: input.invitedBy,
    invited_at: new Date().toISOString(),
    accepted_by: null,
    accepted_at: null,
    revoked_by: null,
    revoked_at: null,
    invite_error: null,
  };

  if (existing) {
    const { data, error } = await supabaseAdmin
      .from("company_user_invitations")
      .update(values)
      .eq("id", existing.id)
      .select(INVITATION_SELECT)
      .single();

    if (error) throw error;
    return data;
  }

  const { data, error } = await supabaseAdmin
    .from("company_user_invitations")
    .insert(values)
    .select(INVITATION_SELECT)
    .single();

  if (error) throw error;
  return data;
}

async function sendSupabaseInvite(input: {
  req: Request;
  invitation: any;
  company: any;
}) {
  const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(
    input.invitation.email,
    {
      redirectTo: buildInviteRedirectTo(input.req),
      data: {
        invited_company_id: input.company.id,
        invited_company_name: input.company.name,
        invited_role: input.invitation.role,
        invitation_id: input.invitation.id,
      },
    }
  );

  if (error) {
    const safeMessage = safeInviteFailureMessage(error);
    await supabaseAdmin
      .from("company_user_invitations")
      .update({
        status: "failed",
        invite_error: safeMessage,
      })
      .eq("id", input.invitation.id);
    throw Object.assign(new Error(safeMessage), { status: 502 });
  }

  const invitedUserId = data?.user?.id || null;
  await supabaseAdmin
    .from("company_user_invitations")
    .update({
      status: "pending",
      supabase_user_id: invitedUserId,
      invite_error: null,
    })
    .eq("id", input.invitation.id);

  return invitedUserId;
}

async function ensureNotRemovingLastTenantAdmin(input: {
  companyId: string;
  targetUserId: string;
  currentRole: string;
  nextRole: string;
  nextActive: boolean;
}) {
  if (!isTenantAdminRole(input.currentRole)) return;
  if (input.nextActive && isTenantAdminRole(input.nextRole)) return;

  const { data, error } = await supabaseAdmin
    .from("company_users")
    .select("user_id, role, is_active")
    .eq("company_id", input.companyId)
    .eq("is_active", true)
    .in("role", ["owner", "admin"]);

  if (error) throw error;

  const remainingAdmins = (data || []).filter(
    (membership) => membership.user_id !== input.targetUserId
  );

  if (remainingAdmins.length === 0) {
    const err = new Error("At least one active owner/admin must remain in this company.");
    (err as any).status = 400;
    throw err;
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const resolved = await resolveAccess(req, searchParams.get("companyId"));
    if ("error" in resolved) return resolved.error;

    const { data: memberships, error: membershipError } = await supabaseAdmin
      .from("company_users")
      .select(MEMBERSHIP_SELECT)
      .eq("company_id", resolved.company.id)
      .order("role", { ascending: true });

    if (membershipError) throw membershipError;

    const { data: invitationRows, error: invitationsError } = await supabaseAdmin
      .from("company_user_invitations")
      .select(INVITATION_SELECT)
      .eq("company_id", resolved.company.id)
      .in("status", ["pending", "failed"])
      .is("accepted_at", null)
      .is("revoked_at", null)
      .order("invited_at", { ascending: false })
      .limit(100);

    if (invitationsError) throw invitationsError;

    const { usersById, error: usersError } = await listAuthUsersById();
    const userLookupWarning = usersError
      ? "User email lookup is unavailable; membership IDs are shown instead."
      : null;

    const visibleMemberships = resolved.isPlatformOwner
      ? memberships || []
      : (memberships || []).filter((membership) => !isInternalRole(membership.role));

    const users = visibleMemberships.map((membership) => {
      const role = normalizeRole(membership.role);
      const authUser = usersById.get(membership.user_id);
      return {
        user_id: membership.user_id,
        company_id: membership.company_id,
        role,
        is_active: Boolean(membership.is_active),
        protected_role: isInternalRole(role),
        ...safeUserSummary(authUser),
      };
    });

    return noStoreJson({
      success: true,
      company: safeCompany(resolved.company),
      is_platform_owner: resolved.isPlatformOwner,
      users,
      invitations: (invitationRows || []).map(safeInvitation),
      allowed_roles: Array.from(PILOT_ROLES),
      invite_flow: {
        mode: "email_invite",
        message:
          "Invite users by email. They are added to this workspace after accepting the invitation and signing in.",
      },
      warning: userLookupWarning,
    });
  } catch (err: any) {
    console.error("Team Access GET error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to load Team Access" },
      { status: err.status || 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const resolved = await resolveAccess(req, body.companyId);
    if ("error" in resolved) return resolved.error;

    const email = normalizeEmail(body.email);
    const role = normalizeTeamRole(body.role || "ops");

    if (!email) {
      return noStoreJson(
        { success: false, error: "User email is required" },
        { status: 400 }
      );
    }
    if (!isValidEmail(email)) {
      return noStoreJson(
        { success: false, error: "Enter a valid work email" },
        { status: 400 }
      );
    }
    if (!role) {
      return noStoreJson(
        { success: false, error: "Choose a valid workspace role" },
        { status: 400 }
      );
    }
    if (!canGrantRole(resolved, role)) {
      return noStoreJson(
        { success: false, error: "You cannot grant that workspace role" },
        { status: 403 }
      );
    }

    const authUser = await findAuthUserByEmail(email);
    if (!authUser) {
      const invitation = await createOrUpdatePendingInvitation({
        companyId: resolved.company.id,
        email,
        role,
        invitedBy: resolved.user.id,
      });
      await sendSupabaseInvite({ req, invitation, company: resolved.company });

      return noStoreJson({
        success: true,
        mode: "invited",
        message: "Invitation sent. The user will be added after accepting it.",
      });
    }

    if (!resolved.isPlatformOwner && (await userHasInternalAccess(authUser.id))) {
      return noStoreJson(
        { success: false, error: "This account cannot be managed from Team Access." },
        { status: 403 }
      );
    }

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("company_users")
      .select(MEMBERSHIP_SELECT)
      .eq("company_id", resolved.company.id)
      .eq("user_id", authUser.id)
      .maybeSingle();

    if (existingError) throw existingError;

    if (existing) {
      if (isInternalRole(existing.role) && !resolved.isPlatformOwner) {
        return noStoreJson(
          { success: false, error: "This account cannot be managed from Team Access." },
          { status: 403 }
        );
      }

      if (Boolean(existing.is_active)) {
        return noStoreJson({
          success: true,
          mode: "already_active",
          message: "That user already has access to this workspace.",
        });
      }

      const { error: updateError } = await supabaseAdmin
        .from("company_users")
        .update({ role, is_active: true })
        .eq("company_id", resolved.company.id)
        .eq("user_id", authUser.id);

      if (updateError) throw updateError;
    } else {
      const { error: insertError } = await supabaseAdmin
        .from("company_users")
        .insert({
          company_id: resolved.company.id,
          user_id: authUser.id,
          role,
          is_active: true,
        });

      if (insertError) throw insertError;
    }

    await markPendingInvitationsAccepted({
      companyId: resolved.company.id,
      email,
      userId: authUser.id,
    });

    return noStoreJson({
      success: true,
      mode: "added_existing",
      message: "Team access updated.",
    });
  } catch (err: any) {
    console.error("Team Access POST error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to add team user" },
      { status: err.status || 500 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const resolved = await resolveAccess(req, body.companyId);
    if ("error" in resolved) return resolved.error;

    const invitationId = String(body.invitationId || "").trim();
    const invitationAction = String(body.action || "").trim();

    if (invitationId) {
      const { data: invitation, error: invitationError } = await supabaseAdmin
        .from("company_user_invitations")
        .select(INVITATION_SELECT)
        .eq("company_id", resolved.company.id)
        .eq("id", invitationId)
        .maybeSingle();

      if (invitationError) throw invitationError;
      if (!invitation || invitation.accepted_at || invitation.revoked_at) {
        return noStoreJson(
          { success: false, error: "Invitation not found" },
          { status: 404 }
        );
      }

      if (invitationAction === "revoke_invite") {
        const { error: updateError } = await supabaseAdmin
          .from("company_user_invitations")
          .update({
            status: "revoked",
            revoked_at: new Date().toISOString(),
            revoked_by: resolved.user.id,
          })
          .eq("id", invitation.id);

        if (updateError) throw updateError;
        return noStoreJson({
          success: true,
          message: "Invitation revoked.",
        });
      }

      if (invitationAction === "resend_invite") {
        const role = normalizeTeamRole(invitation.role);
        if (!canGrantRole(resolved, role)) {
          return noStoreJson(
            { success: false, error: "You cannot grant that workspace role" },
            { status: 403 }
          );
        }

        const { data: refreshedInvitation, error: refreshError } = await supabaseAdmin
          .from("company_user_invitations")
          .update({
            status: "pending",
            invited_by: resolved.user.id,
            invited_at: new Date().toISOString(),
            invite_error: null,
          })
          .eq("id", invitation.id)
          .select(INVITATION_SELECT)
          .single();

        if (refreshError) throw refreshError;

        await sendSupabaseInvite({
          req,
          invitation: refreshedInvitation,
          company: resolved.company,
        });

        return noStoreJson({
          success: true,
          message: "Invitation resent.",
        });
      }

      return noStoreJson(
        { success: false, error: "Choose a valid invitation action" },
        { status: 400 }
      );
    }

    const targetUserId = String(body.userId || "").trim();
    if (!targetUserId) {
      return noStoreJson(
        { success: false, error: "User id is required" },
        { status: 400 }
      );
    }

    const { data: current, error: currentError } = await supabaseAdmin
      .from("company_users")
      .select(MEMBERSHIP_SELECT)
      .eq("company_id", resolved.company.id)
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (currentError) throw currentError;
    if (!current) {
      return noStoreJson(
        { success: false, error: "Team user not found" },
        { status: 404 }
      );
    }

    const currentRole = normalizeRole(current.role);
    if (isInternalRole(currentRole) && !resolved.isPlatformOwner) {
      return noStoreJson(
        { success: false, error: "Team user not found" },
        { status: 404 }
      );
    }

    const nextRole = body.role === undefined ? currentRole : normalizeTeamRole(body.role);
    if (!nextRole) {
      return noStoreJson(
        { success: false, error: "Choose a valid workspace role" },
        { status: 400 }
      );
    }
    if (body.role !== undefined && !canGrantRole(resolved, nextRole)) {
      return noStoreJson(
        { success: false, error: "You cannot grant that workspace role" },
        { status: 403 }
      );
    }

    const nextActive =
      typeof body.isActive === "boolean" ? body.isActive : Boolean(current.is_active);

    await ensureNotRemovingLastTenantAdmin({
      companyId: resolved.company.id,
      targetUserId,
      currentRole,
      nextRole,
      nextActive,
    });

    const { error: updateError } = await supabaseAdmin
      .from("company_users")
      .update({
        role: nextRole,
        is_active: nextActive,
      })
      .eq("company_id", resolved.company.id)
      .eq("user_id", targetUserId);

    if (updateError) throw updateError;

    return noStoreJson({
      success: true,
      message: "Team access updated.",
    });
  } catch (err: any) {
    console.error("Team Access PATCH error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to update team user" },
      { status: err.status || 500 }
    );
  }
}
