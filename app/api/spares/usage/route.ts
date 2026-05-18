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
  "finance",
  "management",
]);
const MANAGE_ROLES = new Set(["platform_owner", "owner", "admin", "ops"]);
const EVENT_TYPES = new Set([
  "installed",
  "removed",
  "repaired",
  "retreaded",
  "transferred",
  "scrapped",
  "purchased",
  "inspected",
  "returned_to_stock",
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

function sanitizeEvent(event: any) {
  return {
    id: event.id,
    event_type: event.event_type || null,
    event_at: event.event_at || null,
    part_name: event.part_name || null,
    quantity:
      event.quantity === null || event.quantity === undefined
        ? null
        : Number(event.quantity),
    asset_id: event.asset_id || null,
    truck_id: event.truck_id || null,
    journey_id: event.journey_id || null,
    vendor_name: event.vendor_name || null,
    mechanic_name: event.mechanic_name || null,
    condition_before: event.condition_before || null,
    condition_after: event.condition_after || null,
    odometer:
      event.odometer === null || event.odometer === undefined
        ? null
        : Number(event.odometer),
    engine_hours:
      event.engine_hours === null || event.engine_hours === undefined
        ? null
        : Number(event.engine_hours),
    cost:
      event.cost === null || event.cost === undefined ? null : Number(event.cost),
    notes: event.notes || null,
    from_asset_id: event.from_asset_id || null,
    to_asset_id: event.to_asset_id || null,
    created_at: event.created_at || null,
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
    can_view_spares_usage: canView,
    can_manage_spares_usage: canManage,
  };
}

function badRequestStatus(err: any) {
  const message = String(err?.message || "");
  if (message.includes("not found")) return 404;
  return message.includes("required") ||
    message.includes("Invalid") ||
    message.includes("positive") ||
    message.includes("must be")
    ? 400
    : 500;
}

function normalizeOptionalText(value: any) {
  if (value === undefined) return undefined;
  const text = String(value || "").trim();
  return text || null;
}

function normalizeUpperText(value: any) {
  const text = normalizeOptionalText(value);
  return text ? text.toUpperCase() : text;
}

function normalizePositiveNumber(value: any, label: string, required = false) {
  if (value === undefined || value === null || String(value).trim() === "") {
    if (required) throw new Error(`${label} is required`);
    return null;
  }

  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${label} must be a positive number`);
  }

  return number;
}

function normalizeEventAt(value: any) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return new Date().toISOString();
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid event_at");
  return date.toISOString();
}

async function resolveSparesAccess(
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
        { success: false, error: "Spares access required" },
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
        { success: false, error: "Spares access required" },
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

async function fetchAssetById(companyId: string, id: string) {
  const { data, error } = await supabaseAdmin
    .from("fleet_assets")
    .select("id, truck_id, registration, status, intelligence_enabled")
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function verifyTransferAsset(companyId: string, id: string, label: string) {
  if (!id) return null;
  const asset = await fetchAssetById(companyId, id);
  if (!asset) throw new Error(`${label} not found`);
  return asset;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const resolved = await resolveSparesAccess(
      req,
      searchParams.get("companyId"),
      "view"
    );
    if (resolved.error) return resolved.error;

    const { data: events, error } = await supabaseAdmin
      .from("spare_lifecycle_events")
      .select(
        "id, event_type, event_at, part_name, quantity, asset_id, truck_id, journey_id, vendor_name, mechanic_name, condition_before, condition_after, odometer, engine_hours, cost, notes, from_asset_id, to_asset_id, created_at"
      )
      .eq("company_id", resolved.company.id)
      .order("event_at", { ascending: false });

    if (error) throw error;

    return noStoreJson({
      success: true,
      company: resolved.company,
      is_platform_owner: resolved.isPlatformOwner,
      roles: resolved.roles,
      capabilities: resolved.capabilities,
      events: (events || []).map(sanitizeEvent),
    });
  } catch (err: any) {
    console.error("Spares usage GET error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to load spare usage" },
      { status: badRequestStatus(err) }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const resolved = await resolveSparesAccess(
      req,
      body.companyId || null,
      "manage"
    );
    if (resolved.error) return resolved.error;

    const eventType = String(body.event_type || "").trim().toLowerCase();
    if (!EVENT_TYPES.has(eventType)) throw new Error("Invalid event_type");

    const partName = String(body.part_name || "").trim();
    if (!partName) throw new Error("part_name is required");

    const quantity = normalizePositiveNumber(body.quantity, "quantity", true);
    const cost = normalizePositiveNumber(body.cost, "cost");
    const odometer = normalizePositiveNumber(body.odometer, "odometer");
    const engineHours = normalizePositiveNumber(body.engine_hours, "engine_hours");

    const assetId = String(body.asset_id || "").trim() || null;
    const fromAssetId = String(body.from_asset_id || "").trim() || null;
    const toAssetId = String(body.to_asset_id || "").trim() || null;
    const journeyId = String(body.journey_id || "").trim() || null;

    let selectedAsset: any = null;
    if (assetId) {
      selectedAsset = await fetchAssetById(resolved.company.id, assetId);
      if (!selectedAsset) throw new Error("Asset not found");
      if (String(selectedAsset.status || "").toLowerCase() !== "active") {
        throw new Error("Asset must be active");
      }
      if (!selectedAsset.intelligence_enabled) {
        throw new Error("Asset must be enabled for Nava intelligence");
      }
    }

    const [fromAsset, toAsset] = await Promise.all([
      fromAssetId
        ? verifyTransferAsset(resolved.company.id, fromAssetId, "from_asset_id")
        : Promise.resolve(null),
      toAssetId
        ? verifyTransferAsset(resolved.company.id, toAssetId, "to_asset_id")
        : Promise.resolve(null),
    ]);

    if (journeyId) {
      const { data: journey, error: journeyError } = await supabaseAdmin
        .from("journeys")
        .select("id")
        .eq("company_id", resolved.company.id)
        .eq("is_demo", false)
        .eq("id", journeyId)
        .maybeSingle();

      if (journeyError) throw journeyError;
      if (!journey) throw new Error("Journey not found");
    }

    const fallbackAsset = selectedAsset || toAsset || fromAsset || null;
    const truckId =
      fallbackAsset?.truck_id || fallbackAsset?.registration || normalizeUpperText(body.truck_id);

    const insertPayload: Record<string, any> = {
      company_id: resolved.company.id,
      event_type: eventType,
      event_at: normalizeEventAt(body.event_at),
      part_name: partName,
      quantity,
      asset_id: assetId,
      truck_id: truckId || null,
      journey_id: journeyId,
      vendor_name: normalizeUpperText(body.vendor_name),
      mechanic_name: normalizeOptionalText(body.mechanic_name),
      condition_before: normalizeOptionalText(body.condition_before),
      condition_after: normalizeOptionalText(body.condition_after),
      odometer,
      engine_hours: engineHours,
      cost,
      notes: normalizeOptionalText(body.notes),
      from_asset_id: fromAssetId,
      to_asset_id: toAssetId,
      created_by: resolved.userId,
    };

    const { data: event, error } = await supabaseAdmin
      .from("spare_lifecycle_events")
      .insert(insertPayload)
      .select(
        "id, event_type, event_at, part_name, quantity, asset_id, truck_id, journey_id, vendor_name, mechanic_name, condition_before, condition_after, odometer, engine_hours, cost, notes, from_asset_id, to_asset_id, created_at"
      )
      .single();

    if (error) throw error;

    return noStoreJson({
      success: true,
      event: sanitizeEvent(event),
    });
  } catch (err: any) {
    console.error("Spares usage POST error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to save spare usage" },
      { status: badRequestStatus(err) }
    );
  }
}
