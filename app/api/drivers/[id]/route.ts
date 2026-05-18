import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

function normalizeDriverUpdate(body: any) {
  const updates: Record<string, any> = {};

  if (body.full_name !== undefined) {
    const fullName = String(body.full_name || "").trim();
    if (!fullName) throw new Error("Full name is required");
    updates.full_name = fullName;
  }

  for (const field of ["phone", "employee_code", "license_number", "notes"]) {
    if (body[field] !== undefined) {
      updates[field] = normalizeOptionalText(body[field]);
    }
  }

  if (body.status !== undefined) {
    const status = String(body.status || "").trim().toLowerCase();
    if (!DRIVER_STATUSES.has(status)) {
      throw new Error("Invalid driver status");
    }
    updates.status = status;
  }

  if (Object.keys(updates).length === 0) {
    throw new Error("No valid driver updates provided");
  }

  updates.updated_at = new Date().toISOString();
  return updates;
}

async function resolveDriverAccess(req: Request, requestedCompanyId?: string | null) {
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
  const hasManageRole =
    isPlatformOwner || roles.some((role) => MANAGE_ROLES.has(role));

  if (!hasManageRole) {
    return {
      error: noStoreJson(
        { success: false, error: "Driver management access required" },
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
    };
  }

  const membership = activeMemberships.find((item) =>
    MANAGE_ROLES.has(String(item.role || "").toLowerCase())
  );
  const companyId = membership?.company_id;

  if (!companyId) {
    return {
      error: noStoreJson(
        { success: false, error: "Driver management access required" },
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
  };
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const resolved = await resolveDriverAccess(req, body.companyId || null);
    if (resolved.error) return resolved.error;

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("drivers")
      .select("id, company_id")
      .eq("company_id", resolved.company.id)
      .eq("id", params.id)
      .maybeSingle();

    if (existingError) throw existingError;
    if (!existing) {
      return noStoreJson(
        { success: false, error: "Driver not found" },
        { status: 404 }
      );
    }

    const updates = normalizeDriverUpdate(body);

    const { data: driver, error: updateError } = await supabaseAdmin
      .from("drivers")
      .update(updates)
      .eq("company_id", resolved.company.id)
      .eq("id", params.id)
      .select("id, full_name, phone, employee_code, status, notes, created_at, updated_at")
      .single();

    if (updateError) throw updateError;

    return noStoreJson({
      success: true,
      driver: sanitizeDriver(driver),
    });
  } catch (err: any) {
    console.error("Drivers PATCH error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to update driver" },
      { status: badRequestStatus(err) }
    );
  }
}
