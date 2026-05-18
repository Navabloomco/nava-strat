import { NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const VIEW_ROLES = new Set([
  "platform_owner",
  "owner",
  "admin",
  "ops",
  "finance",
  "management",
]);
const MANAGE_ROLES = new Set(["platform_owner", "owner", "admin", "ops"]);
const DRIVER_STATUSES = new Set(["active", "inactive", "suspended"]);

type ResolvedCompany = {
  id: string;
  name: string;
  slug: string;
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

function sanitizeDriver(driver: any) {
  return {
    id: driver.id,
    full_name: driver.full_name || null,
    phone: driver.phone || null,
    employee_code: driver.employee_code || null,
    status: driver.status || "active",
    notes: driver.notes || null,
    created_at: driver.created_at || null,
    updated_at: driver.updated_at || null,
  };
}

function buildCapabilities(roles: string[], isPlatformOwner: boolean) {
  const normalizedRoles = new Set(roles.map((role) => role.toLowerCase()));
  const canManage =
    isPlatformOwner ||
    normalizedRoles.has("platform_owner") ||
    normalizedRoles.has("owner") ||
    normalizedRoles.has("admin") ||
    normalizedRoles.has("ops");
  const canView =
    canManage ||
    normalizedRoles.has("finance") ||
    normalizedRoles.has("management");

  return {
    can_view_drivers: canView,
    can_manage_drivers: canManage,
  };
}

function badRequestStatus(err: any) {
  const message = String(err?.message || "");
  return message.includes("required") ||
    message.includes("Invalid") ||
    message.includes("No valid")
    ? 400
    : 500;
}

function normalizeOptionalText(value: any) {
  if (value === undefined) return undefined;
  const text = String(value || "").trim();
  return text || null;
}

function normalizeDriverInput(body: any, mode: "create" | "update") {
  const updates: Record<string, any> = {};

  if (mode === "create" || body.full_name !== undefined) {
    const fullName = String(body.full_name || "").trim();
    if (!fullName) throw new Error("Full name is required");
    updates.full_name = fullName;
  }

  for (const field of ["phone", "employee_code", "license_number", "notes"]) {
    if (body[field] !== undefined) {
      updates[field] = normalizeOptionalText(body[field]);
    }
  }

  if (body.status !== undefined || mode === "create") {
    const status = String(body.status || "active").trim().toLowerCase();
    if (!DRIVER_STATUSES.has(status)) {
      throw new Error("Invalid driver status");
    }
    updates.status = status;
  }

  if (mode === "update") {
    if (Object.keys(updates).length === 0) {
      throw new Error("No valid driver updates provided");
    }
    updates.updated_at = new Date().toISOString();
  }

  return updates;
}

async function resolveDriverAccess(
  req: Request,
  requestedCompanyId?: string | null,
  mode: "view" | "manage" = "view"
) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return {
      error: noStoreJson(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      ),
    };
  }

  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return {
      error: noStoreJson(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      ),
    };
  }

  const { data: memberships, error: membershipError } = await supabaseAdmin
    .from("company_users")
    .select("company_id, role, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (membershipError) throw membershipError;

  const activeMemberships = memberships || [];
  const roles = Array.from(
    new Set(
      activeMemberships
        .map((membership) => String(membership.role || "").toLowerCase())
        .filter(Boolean)
    )
  );
  const isPlatformOwner = roles.includes("platform_owner");
  const capabilities = buildCapabilities(roles, isPlatformOwner);
  const allowedRoles = mode === "manage" ? MANAGE_ROLES : VIEW_ROLES;
  const hasAllowedRole =
    isPlatformOwner || roles.some((role) => allowedRoles.has(role));

  if (!hasAllowedRole) {
    return {
      error: noStoreJson(
        { success: false, error: "Driver access required" },
        { status: 403 }
      ),
    };
  }

  if (isPlatformOwner) {
    const companyQuery = supabaseAdmin.from("companies").select("id, name, slug");
    const { data: company, error: companyError } = requestedCompanyId
      ? await companyQuery.eq("id", requestedCompanyId).maybeSingle()
      : await companyQuery.order("name", { ascending: true }).limit(1).maybeSingle();

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
      company: company as ResolvedCompany,
      userId: user.id,
      roles,
      isPlatformOwner,
      capabilities,
    };
  }

  const membership = activeMemberships.find((item) =>
    allowedRoles.has(String(item.role || "").toLowerCase())
  );
  const companyId = membership?.company_id;

  if (!companyId) {
    return {
      error: noStoreJson(
        { success: false, error: "Driver access required" },
        { status: 403 }
      ),
    };
  }

  const { data: company, error: companyError } = await supabaseAdmin
    .from("companies")
    .select("id, name, slug")
    .eq("id", companyId)
    .maybeSingle();

  if (companyError) throw companyError;
  if (!company) {
    return {
      error: noStoreJson(
        { success: false, error: "Unable to resolve company access" },
        { status: 403 }
      ),
    };
  }

  return {
    company: company as ResolvedCompany,
    userId: user.id,
    roles,
    isPlatformOwner,
    capabilities,
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const resolved = await resolveDriverAccess(
      req,
      searchParams.get("companyId"),
      "view"
    );
    if (resolved.error) return resolved.error;

    const { data: drivers, error } = await supabaseAdmin
      .from("drivers")
      .select("id, full_name, phone, employee_code, status, notes, created_at, updated_at")
      .eq("company_id", resolved.company.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return noStoreJson({
      success: true,
      company: resolved.company,
      is_platform_owner: resolved.isPlatformOwner,
      roles: resolved.roles,
      capabilities: resolved.capabilities,
      drivers: (drivers || []).map(sanitizeDriver),
    });
  } catch (err: any) {
    console.error("Drivers GET error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to load drivers" },
      { status: badRequestStatus(err) }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const resolved = await resolveDriverAccess(
      req,
      body.companyId || null,
      "manage"
    );
    if (resolved.error) return resolved.error;

    const input = normalizeDriverInput(body, "create");

    const { data: driver, error } = await supabaseAdmin
      .from("drivers")
      .insert({
        company_id: resolved.company.id,
        ...input,
      })
      .select("id, full_name, phone, employee_code, status, notes, created_at, updated_at")
      .single();

    if (error) throw error;

    return noStoreJson({
      success: true,
      driver: sanitizeDriver(driver),
    });
  } catch (err: any) {
    console.error("Drivers POST error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to create driver" },
      { status: badRequestStatus(err) }
    );
  }
}
