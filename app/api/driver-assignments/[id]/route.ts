import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MANAGE_ROLES = new Set(["platform_owner", "owner", "admin", "ops"]);

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

function badRequestStatus(err: any) {
  const message = String(err?.message || "");
  if (message.includes("overlap")) return 409;
  if (message.includes("not found")) return 404;
  return message.includes("required") ||
    message.includes("Invalid") ||
    message.includes("must be") ||
    message.includes("already ended") ||
    message.includes("active assignments")
    ? 400
    : 500;
}

function parseDateInput(value: any, field: string, fallback?: string) {
  if (value === undefined || value === null || String(value).trim() === "") {
    if (fallback) return fallback;
    throw new Error(`Invalid ${field}`);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${field}`);
  }

  return date.toISOString();
}

function sanitizeAssignment(assignment: any, asset?: any) {
  return {
    id: assignment.id,
    asset_id: assignment.asset_id || null,
    truck_id: assignment.truck_id || null,
    driver_id: assignment.driver_id || null,
    driver_name: assignment.driver_name || null,
    journey_id: assignment.journey_id || null,
    assigned_from: assignment.assigned_from || null,
    assigned_to: assignment.assigned_to || null,
    assignment_status: assignment.assignment_status || "active",
    created_at: assignment.created_at || null,
    ended_at: assignment.ended_at || null,
    asset_registration: asset?.registration || null,
    asset_provider_name: asset?.provider_name || null,
  };
}

function windowsOverlap(
  startA: string,
  endA: string | null,
  startB: string,
  endB: string | null
) {
  const aStart = new Date(startA).getTime();
  const aEnd = endA ? new Date(endA).getTime() : Number.POSITIVE_INFINITY;
  const bStart = new Date(startB).getTime();
  const bEnd = endB ? new Date(endB).getTime() : Number.POSITIVE_INFINITY;

  return aStart < bEnd && bStart < aEnd;
}

async function resolveAssignmentManageAccess(
  req: Request,
  requestedCompanyId?: string | null
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
  const hasManageRole =
    isPlatformOwner || roles.some((role) => MANAGE_ROLES.has(role));

  if (!hasManageRole) {
    return {
      error: noStoreJson(
        { success: false, error: "Driver assignment management access required" },
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
        { success: false, error: "Driver assignment management access required" },
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

async function assertNoWindowOverlap(
  companyId: string,
  assignment: any,
  nextAssignedFrom: string
) {
  const { data: assignments, error } = await supabaseAdmin
    .from("asset_driver_assignments")
    .select("id, asset_id, truck_id, assigned_from, assigned_to")
    .eq("company_id", companyId);

  if (error) throw error;

  const truckId = String(assignment.truck_id || "").trim().toLowerCase();
  const overlap = (assignments || []).find((item) => {
    if (item.id === assignment.id) return false;
    const sameAsset =
      assignment.asset_id && item.asset_id && item.asset_id === assignment.asset_id;
    const sameTruck =
      String(item.truck_id || "").trim().toLowerCase() === truckId;
    if (!sameAsset && !sameTruck) return false;

    return windowsOverlap(
      nextAssignedFrom,
      assignment.assigned_to || null,
      item.assigned_from,
      item.assigned_to || null
    );
  });

  if (overlap) {
    throw new Error("Updated assignment window would overlap another assignment");
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const resolved = await resolveAssignmentManageAccess(
      req,
      body.companyId || null
    );
    if (resolved.error) return resolved.error;

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("asset_driver_assignments")
      .select(
        "id, company_id, asset_id, truck_id, driver_id, driver_name, journey_id, assigned_from, assigned_to, assignment_status, created_at, ended_at"
      )
      .eq("company_id", resolved.company.id)
      .eq("id", params.id)
      .maybeSingle();

    if (existingError) throw existingError;
    if (!existing) {
      return noStoreJson(
        { success: false, error: "Driver assignment not found" },
        { status: 404 }
      );
    }

    const now = new Date().toISOString();
    const action = String(body.action || "").trim().toLowerCase();
    const updates: Record<string, any> = {};

    if (action === "end") {
      if (
        existing.assignment_status !== "active" ||
        existing.assigned_to ||
        existing.ended_at
      ) {
        throw new Error("Driver assignment is already ended");
      }

      const assignedTo = parseDateInput(body.assigned_to, "assigned_to", now);
      if (new Date(assignedTo!).getTime() < new Date(existing.assigned_from).getTime()) {
        throw new Error("assigned_to must be after assigned_from");
      }

      updates.assigned_to = assignedTo;
      updates.assignment_status = "ended";
      updates.ended_by = resolved.userId;
      updates.ended_at = now;
      updates.updated_at = now;
    } else if (body.assigned_from !== undefined) {
      if (
        existing.assignment_status !== "active" ||
        existing.assigned_to ||
        existing.ended_at
      ) {
        throw new Error("Only active assignments can update assigned_from");
      }

      const assignedFrom = parseDateInput(body.assigned_from, "assigned_from");
      await assertNoWindowOverlap(resolved.company.id, existing, assignedFrom!);

      updates.assigned_from = assignedFrom;
      updates.updated_at = now;
    } else {
      throw new Error("No valid driver assignment update provided");
    }

    const { data: assignment, error: updateError } = await supabaseAdmin
      .from("asset_driver_assignments")
      .update(updates)
      .eq("company_id", resolved.company.id)
      .eq("id", params.id)
      .select(
        "id, asset_id, truck_id, driver_id, driver_name, journey_id, assigned_from, assigned_to, assignment_status, created_at, ended_at"
      )
      .single();

    if (updateError) throw updateError;

    let asset: any = null;
    if (assignment.asset_id) {
      const { data: assetData, error: assetError } = await supabaseAdmin
        .from("fleet_assets")
        .select("id, registration, provider_name")
        .eq("company_id", resolved.company.id)
        .eq("id", assignment.asset_id)
        .maybeSingle();

      if (assetError) throw assetError;
      asset = assetData;
    }

    return noStoreJson({
      success: true,
      assignment: sanitizeAssignment(assignment, asset),
    });
  } catch (err: any) {
    console.error("Driver assignments PATCH error:", err);
    return noStoreJson(
      {
        success: false,
        error: err.message || "Failed to update driver assignment",
      },
      { status: badRequestStatus(err) }
    );
  }
}
