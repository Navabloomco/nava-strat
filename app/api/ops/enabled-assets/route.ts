import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const VIEW_ROLES = new Set([
  "platform_owner",
  "owner",
  "admin",
  "ops",
  "management",
]);

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

function normalizeTruckKey(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function sanitizeAssignedDriver(assignment: any) {
  if (!assignment) return null;

  return {
    id: assignment.id,
    driver_id: assignment.driver_id || null,
    driver_name: assignment.driver_name || null,
    assigned_from: assignment.assigned_from || null,
  };
}

function sanitizeAsset(asset: any, assignedDriver: any) {
  return {
    id: asset.id,
    truck_id: asset.truck_id || null,
    registration: asset.registration || null,
    asset_category: asset.asset_category || null,
    provider_name: asset.provider_name || null,
    status: asset.status || null,
    last_seen_at: asset.last_seen_at || null,
    assigned_driver: sanitizeAssignedDriver(assignedDriver),
  };
}

async function resolveAccess(req: Request, requestedCompanyId?: string | null) {
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
  const hasAllowedRole =
    isPlatformOwner || roles.some((role) => VIEW_ROLES.has(role));

  if (!hasAllowedRole) {
    return {
      error: noStoreJson(
        { success: false, error: "Operations asset access required" },
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
      roles,
      isPlatformOwner,
    };
  }

  const membership = activeMemberships.find((item) =>
    VIEW_ROLES.has(String(item.role || "").toLowerCase())
  );
  const companyId = membership?.company_id;

  if (!companyId) {
    return {
      error: noStoreJson(
        { success: false, error: "Operations asset access required" },
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
    roles,
    isPlatformOwner,
  };
}

function buildAssignmentLookup(assignments: any[]) {
  const now = Date.now();
  const byAssetId = new Map<string, any>();
  const byTruckKey = new Map<string, any>();

  for (const assignment of assignments) {
    const assignedTo = assignment.assigned_to
      ? new Date(assignment.assigned_to).getTime()
      : null;
    const isCurrent =
      assignment.assignment_status === "active" &&
      (!assignedTo || assignedTo > now);

    if (!isCurrent) continue;

    if (assignment.asset_id && !byAssetId.has(assignment.asset_id)) {
      byAssetId.set(assignment.asset_id, assignment);
    }

    const truckKey = normalizeTruckKey(assignment.truck_id);
    if (truckKey && !byTruckKey.has(truckKey)) {
      byTruckKey.set(truckKey, assignment);
    }
  }

  return { byAssetId, byTruckKey };
}

function findAssignedDriver(asset: any, lookup: ReturnType<typeof buildAssignmentLookup>) {
  return (
    (asset.id && lookup.byAssetId.get(asset.id)) ||
    lookup.byTruckKey.get(normalizeTruckKey(asset.truck_id)) ||
    lookup.byTruckKey.get(normalizeTruckKey(asset.registration)) ||
    null
  );
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const resolved = await resolveAccess(req, searchParams.get("companyId"));
    if (resolved.error) return resolved.error;

    const [assetsResult, assignmentsResult] = await Promise.all([
      supabaseAdmin
        .from("fleet_assets")
        .select(
          "id, truck_id, registration, asset_category, provider_name, status, last_seen_at"
        )
        .eq("company_id", resolved.company.id)
        .eq("status", "active")
        .eq("intelligence_enabled", true)
        .order("registration", { ascending: true }),
      supabaseAdmin
        .from("asset_driver_assignments")
        .select(
          "id, asset_id, truck_id, driver_id, driver_name, assigned_from, assigned_to, assignment_status"
        )
        .eq("company_id", resolved.company.id)
        .eq("assignment_status", "active"),
    ]);

    if (assetsResult.error) throw assetsResult.error;
    if (assignmentsResult.error) throw assignmentsResult.error;

    const lookup = buildAssignmentLookup(assignmentsResult.data || []);
    const assets = (assetsResult.data || []).map((asset) =>
      sanitizeAsset(asset, findAssignedDriver(asset, lookup))
    );

    return noStoreJson({
      success: true,
      company: resolved.company,
      is_platform_owner: resolved.isPlatformOwner,
      roles: resolved.roles,
      assets,
    });
  } catch (err: any) {
    console.error("Enabled ops assets GET error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to load enabled assets" },
      { status: 500 }
    );
  }
}
