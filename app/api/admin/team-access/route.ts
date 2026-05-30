import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { normalizeRole } from "../../../../lib/api/roleAccess";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const COMPANY_SELECT = "id, name, slug";
const MEMBERSHIP_SELECT = "company_id, user_id, role, is_active";
const PILOT_ROLES = new Set(["owner", "admin", "ops", "finance", "management"]);
const TENANT_ADMIN_ROLES = new Set(["owner", "admin"]);

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

function normalizeTeamRole(value: any) {
  const role = normalizeRole(value);
  return PILOT_ROLES.has(role) ? role : "";
}

function isTenantAdminRole(role: any) {
  return TENANT_ADMIN_ROLES.has(normalizeRole(role));
}

function safeCompany(company: any) {
  return {
    id: company.id,
    name: company.name,
    slug: company.slug,
  };
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

    const { usersById, error: usersError } = await listAuthUsersById();
    const userLookupWarning = usersError
      ? "User email lookup is unavailable; membership IDs are shown instead."
      : null;

    const users = (memberships || []).map((membership) => {
      const authUser = usersById.get(membership.user_id);
      return {
        user_id: membership.user_id,
        company_id: membership.company_id,
        role: normalizeRole(membership.role),
        is_active: Boolean(membership.is_active),
        protected_role: normalizeRole(membership.role) === "platform_owner",
        ...safeUserSummary(authUser),
      };
    });

    return noStoreJson({
      success: true,
      company: safeCompany(resolved.company),
      is_platform_owner: resolved.isPlatformOwner,
      users,
      allowed_roles: Array.from(PILOT_ROLES),
      invite_flow: {
        mode: "existing_user_only",
        message:
          "Email invitations are not configured yet. Add users after they have created an account.",
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
    if (!role) {
      return noStoreJson(
        { success: false, error: "Choose a valid workspace role" },
        { status: 400 }
      );
    }

    const authUser = await findAuthUserByEmail(email);
    if (!authUser) {
      return noStoreJson(
        {
          success: false,
          error:
            "No existing account was found for that email. Ask the user to sign up first; email invitation automation is not configured yet.",
        },
        { status: 404 }
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
      if (
        normalizeRole(existing.role) === "platform_owner" &&
        !resolved.isPlatformOwner
      ) {
        return noStoreJson(
          { success: false, error: "Platform owner access cannot be changed here" },
          { status: 403 }
        );
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

    return noStoreJson({
      success: true,
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
    if (currentRole === "platform_owner" && !resolved.isPlatformOwner) {
      return noStoreJson(
        { success: false, error: "Platform owner access cannot be changed here" },
        { status: 403 }
      );
    }

    const nextRole = body.role === undefined ? currentRole : normalizeTeamRole(body.role);
    if (!nextRole) {
      return noStoreJson(
        { success: false, error: "Choose a valid workspace role" },
        { status: 400 }
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
