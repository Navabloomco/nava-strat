import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MANAGE_ROLES = new Set(["owner", "admin", "platform_owner"]);
const GEOFENCE_TYPES = new Set([
  "depot",
  "yard",
  "port",
  "customer_site",
  "loading_zone",
  "offloading_zone",
  "border_point",
  "restricted_area",
  "risk_zone",
  "service_area",
  "other",
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

function sanitizeGeofence(geofence: any) {
  return {
    id: geofence.id,
    name: geofence.name,
    type: geofence.type,
    latitude:
      geofence.latitude === null || geofence.latitude === undefined
        ? null
        : Number(geofence.latitude),
    longitude:
      geofence.longitude === null || geofence.longitude === undefined
        ? null
        : Number(geofence.longitude),
    radius_meters:
      geofence.radius_meters === null || geofence.radius_meters === undefined
        ? null
        : Number(geofence.radius_meters),
    is_active: geofence.is_active !== false,
    created_at: geofence.created_at || null,
    updated_at: geofence.updated_at || null,
  };
}

function buildCapabilities(roles: string[], isPlatformOwner: boolean) {
  const normalizedRoles = new Set(roles.map((role) => role.toLowerCase()));
  const canManage =
    isPlatformOwner ||
    normalizedRoles.has("platform_owner") ||
    normalizedRoles.has("owner") ||
    normalizedRoles.has("admin");

  return {
    can_view_geofences: canManage || normalizedRoles.has("ops") || normalizedRoles.has("management"),
    can_manage_geofences: canManage,
  };
}

function parseNumber(value: any, fieldName: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} must be a valid number`);
  }
  return parsed;
}

function badRequestStatus(err: any) {
  const message = String(err?.message || "");
  return message.includes("required") ||
    message.includes("Invalid") ||
    message.includes("must") ||
    message.includes("positive")
    ? 400
    : 500;
}

async function resolveGeofenceAccess(req: Request, requestedCompanyId?: string | null) {
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
  const hasManageRole =
    isPlatformOwner || roles.some((role) => MANAGE_ROLES.has(role));

  if (!hasManageRole) {
    return {
      error: noStoreJson(
        { success: false, error: "Geofence management access required" },
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
    MANAGE_ROLES.has(String(item.role || "").toLowerCase())
  );
  const companyId = membership?.company_id;

  if (!companyId) {
    return {
      error: noStoreJson(
        { success: false, error: "Geofence management access required" },
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

function normalizeUpdate(body: any) {
  const updates: Record<string, any> = {};

  if (body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (!name) throw new Error("Name is required");
    updates.name = name;
  }

  if (body.type !== undefined) {
    const type = String(body.type || "").trim().toLowerCase();
    if (!GEOFENCE_TYPES.has(type)) throw new Error("Invalid geofence type");
    updates.type = type;
  }

  if (body.latitude !== undefined) {
    const latitude = parseNumber(body.latitude, "Latitude");
    if (latitude < -90 || latitude > 90) {
      throw new Error("Latitude must be between -90 and 90");
    }
    updates.latitude = latitude;
  }

  if (body.longitude !== undefined) {
    const longitude = parseNumber(body.longitude, "Longitude");
    if (longitude < -180 || longitude > 180) {
      throw new Error("Longitude must be between -180 and 180");
    }
    updates.longitude = longitude;
  }

  if (body.radius_meters !== undefined) {
    const radiusMeters = parseNumber(body.radius_meters, "Radius");
    if (radiusMeters <= 0) throw new Error("Radius must be positive");
    updates.radius_meters = radiusMeters;
  }

  if (body.is_active !== undefined) {
    updates.is_active = Boolean(body.is_active);
  }

  return updates;
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const resolved = await resolveGeofenceAccess(req, body.companyId || null);
    if (resolved.error) return resolved.error;

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("geofences")
      .select("id, company_id")
      .eq("company_id", resolved.company.id)
      .eq("id", params.id)
      .maybeSingle();

    if (existingError) throw existingError;
    if (!existing) {
      return noStoreJson(
        { success: false, error: "Geofence not found" },
        { status: 404 }
      );
    }

    const now = new Date().toISOString();
    const action = String(body.action || "").trim().toLowerCase();
    const updates =
      action === "archive"
        ? {
            is_active: false,
            archived_at: now,
            archived_by: resolved.userId,
            updated_at: now,
          }
        : {
            ...normalizeUpdate(body),
            updated_at: now,
          };

    if (Object.keys(updates).length === 1 && updates.updated_at) {
      return noStoreJson(
        { success: false, error: "No geofence fields provided" },
        { status: 400 }
      );
    }

    const { data: geofence, error: updateError } = await supabaseAdmin
      .from("geofences")
      .update(updates)
      .eq("company_id", resolved.company.id)
      .eq("id", params.id)
      .select("id, name, type, latitude, longitude, radius_meters, is_active, created_at, updated_at")
      .single();

    if (updateError) throw updateError;

    return noStoreJson({
      success: true,
      company: resolved.company,
      capabilities: resolved.capabilities,
      geofence: sanitizeGeofence(geofence),
    });
  } catch (err: any) {
    console.error("Geofences PATCH error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to update geofence" },
      { status: badRequestStatus(err) }
    );
  }
}
