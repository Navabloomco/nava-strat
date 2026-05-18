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
    can_view_driver_assignments: canView,
    can_manage_driver_assignments: canManage,
  };
}

function badRequestStatus(err: any) {
  const message = String(err?.message || "");
  if (message.includes("already has an active driver assignment")) return 409;
  if (message.includes("not found")) return 404;
  return message.includes("required") ||
    message.includes("Invalid") ||
    message.includes("must be") ||
    message.includes("not active") ||
    message.includes("not enabled")
    ? 400
    : 500;
}

function parseAssignedFrom(value: any) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return new Date().toISOString();
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid assigned_from");
  }

  return date.toISOString();
}

function sanitizeAsset(asset: any) {
  return {
    id: asset.id,
    registration: asset.registration || null,
    truck_id: asset.truck_id || null,
    provider_name: asset.provider_name || null,
    status: asset.status || null,
  };
}

function sanitizeAssignment(assignment: any, assetById?: Map<string, any>) {
  const asset = assignment.asset_id ? assetById?.get(assignment.asset_id) : null;

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

async function resolveAssignmentAccess(
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
        { success: false, error: "Driver assignment access required" },
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
        { success: false, error: "Driver assignment access required" },
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

async function getAssetMap(companyId: string, assetIds: string[]) {
  if (assetIds.length === 0) return new Map<string, any>();

  const { data: assets, error } = await supabaseAdmin
    .from("fleet_assets")
    .select("id, registration, truck_id, provider_name, status")
    .eq("company_id", companyId)
    .in("id", assetIds);

  if (error) throw error;

  return new Map((assets || []).map((asset) => [asset.id, asset]));
}

async function assertNoActiveOverlap(companyId: string, asset: any) {
  const truckId = String(asset.truck_id || "").trim();
  const { data: activeAssignments, error } = await supabaseAdmin
    .from("asset_driver_assignments")
    .select("id, asset_id, truck_id")
    .eq("company_id", companyId)
    .eq("assignment_status", "active")
    .is("assigned_to", null);

  if (error) throw error;

  const overlap = (activeAssignments || []).find(
    (assignment) =>
      assignment.asset_id === asset.id ||
      String(assignment.truck_id || "").trim().toLowerCase() ===
        truckId.toLowerCase()
  );

  if (overlap) {
    throw new Error("This asset already has an active driver assignment");
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const resolved = await resolveAssignmentAccess(
      req,
      searchParams.get("companyId"),
      "view"
    );
    if (resolved.error) return resolved.error;

    const [{ data: assignments, error: assignmentError }, { data: assets, error: assetError }] =
      await Promise.all([
        supabaseAdmin
          .from("asset_driver_assignments")
          .select(
            "id, asset_id, truck_id, driver_id, driver_name, journey_id, assigned_from, assigned_to, assignment_status, created_at, ended_at"
          )
          .eq("company_id", resolved.company.id)
          .order("assigned_from", { ascending: false }),
        supabaseAdmin
          .from("fleet_assets")
          .select("id, registration, truck_id, provider_name, status")
          .eq("company_id", resolved.company.id)
          .eq("status", "active")
          .eq("intelligence_enabled", true)
          .order("registration", { ascending: true }),
      ]);

    if (assignmentError) throw assignmentError;
    if (assetError) throw assetError;

    const assetIds = Array.from(
      new Set((assignments || []).map((assignment) => assignment.asset_id).filter(Boolean))
    );
    const assignmentAssetMap = await getAssetMap(resolved.company.id, assetIds);

    return noStoreJson({
      success: true,
      company: resolved.company,
      is_platform_owner: resolved.isPlatformOwner,
      roles: resolved.roles,
      capabilities: resolved.capabilities,
      assignments: (assignments || []).map((assignment) =>
        sanitizeAssignment(assignment, assignmentAssetMap)
      ),
      enabled_assets: resolved.capabilities.can_manage_driver_assignments
        ? (assets || []).map(sanitizeAsset)
        : [],
    });
  } catch (err: any) {
    console.error("Driver assignments GET error:", err);
    return noStoreJson(
      {
        success: false,
        error: err.message || "Failed to load driver assignments",
      },
      { status: badRequestStatus(err) }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const resolved = await resolveAssignmentAccess(
      req,
      body.companyId || null,
      "manage"
    );
    if (resolved.error) return resolved.error;

    const driverId = String(body.driver_id || "").trim();
    const assetId = String(body.asset_id || "").trim();
    if (!driverId) throw new Error("driver_id is required");
    if (!assetId) throw new Error("asset_id is required");

    const [{ data: driver, error: driverError }, { data: asset, error: assetError }] =
      await Promise.all([
        supabaseAdmin
          .from("drivers")
          .select("id, full_name, status")
          .eq("company_id", resolved.company.id)
          .eq("id", driverId)
          .maybeSingle(),
        supabaseAdmin
          .from("fleet_assets")
          .select("id, registration, truck_id, provider_name, status, intelligence_enabled")
          .eq("company_id", resolved.company.id)
          .eq("id", assetId)
          .maybeSingle(),
      ]);

    if (driverError) throw driverError;
    if (assetError) throw assetError;
    if (!driver) throw new Error("Driver not found");
    if (!asset) throw new Error("Asset not found");
    if (String(driver.status || "").toLowerCase() !== "active") {
      throw new Error("Driver is not active");
    }
    if (String(asset.status || "").toLowerCase() !== "active") {
      throw new Error("Asset is not active");
    }
    if (!asset.intelligence_enabled) {
      throw new Error("Asset is not enabled for Nava intelligence");
    }
    if (!String(asset.truck_id || "").trim()) {
      throw new Error("Selected asset must have a truck_id");
    }

    await assertNoActiveOverlap(resolved.company.id, asset);

    const assignedFrom = parseAssignedFrom(body.assigned_from);

    const { data: assignment, error: insertError } = await supabaseAdmin
      .from("asset_driver_assignments")
      .insert({
        company_id: resolved.company.id,
        asset_id: asset.id,
        truck_id: asset.truck_id,
        driver_id: driver.id,
        driver_name: driver.full_name,
        assigned_from: assignedFrom,
        assignment_status: "active",
        created_by: resolved.userId,
      })
      .select(
        "id, asset_id, truck_id, driver_id, driver_name, journey_id, assigned_from, assigned_to, assignment_status, created_at, ended_at"
      )
      .single();

    if (insertError) throw insertError;

    return noStoreJson({
      success: true,
      assignment: sanitizeAssignment(
        assignment,
        new Map([[asset.id, asset]])
      ),
    });
  } catch (err: any) {
    console.error("Driver assignments POST error:", err);
    return noStoreJson(
      {
        success: false,
        error: err.message || "Failed to create driver assignment",
      },
      { status: badRequestStatus(err) }
    );
  }
}
