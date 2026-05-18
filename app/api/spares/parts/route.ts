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
const PART_CATEGORIES = new Set([
  "tyre",
  "battery",
  "brake",
  "filter",
  "engine",
  "transmission",
  "suspension",
  "electrical",
  "body",
  "consumable",
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

function sanitizePart(part: any) {
  return {
    id: part.id,
    name: part.name || null,
    category: part.category || "other",
    brand: part.brand || null,
    model: part.model || null,
    part_number: part.part_number || null,
    default_unit: part.default_unit || null,
    expected_life_km:
      part.expected_life_km === null || part.expected_life_km === undefined
        ? null
        : Number(part.expected_life_km),
    expected_life_days:
      part.expected_life_days === null || part.expected_life_days === undefined
        ? null
        : Number(part.expected_life_days),
    retreadable: Boolean(part.retreadable),
    max_retreads:
      part.max_retreads === null || part.max_retreads === undefined
        ? null
        : Number(part.max_retreads),
    is_active: part.is_active !== false,
    notes: part.notes || null,
    created_at: part.created_at || null,
    updated_at: part.updated_at || null,
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
    can_view_spares_parts: canView,
    can_manage_spares_parts: canManage,
  };
}

function badRequestStatus(err: any) {
  const message = String(err?.message || "");
  return message.includes("required") ||
    message.includes("Invalid") ||
    message.includes("positive") ||
    message.includes("integer") ||
    message.includes("non-negative")
    ? 400
    : 500;
}

function normalizeOptionalText(value: any) {
  if (value === undefined) return undefined;
  const text = String(value || "").trim();
  return text || null;
}

function normalizePositiveNumber(value: any, label: string) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${label} must be a positive number`);
  }

  return number;
}

function normalizePositiveInteger(value: any, label: string) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }

  return number;
}

function normalizeNonNegativeInteger(value: any, label: string) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }

  return number;
}

function normalizePartInput(body: any, mode: "create" | "update") {
  const updates: Record<string, any> = {};

  if (mode === "create" || body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (!name) throw new Error("name is required");
    updates.name = name;
  }

  if (mode === "create" || body.category !== undefined) {
    const category = String(body.category || "other").trim().toLowerCase();
    if (!PART_CATEGORIES.has(category)) throw new Error("Invalid category");
    updates.category = category;
  }

  for (const field of ["brand", "model", "part_number", "default_unit", "notes"]) {
    if (body[field] !== undefined) {
      updates[field] = normalizeOptionalText(body[field]);
    }
  }

  if (body.expected_life_km !== undefined) {
    updates.expected_life_km = normalizePositiveNumber(
      body.expected_life_km,
      "expected_life_km"
    );
  }

  if (body.expected_life_days !== undefined) {
    updates.expected_life_days = normalizePositiveInteger(
      body.expected_life_days,
      "expected_life_days"
    );
  }

  if (body.retreadable !== undefined || mode === "create") {
    updates.retreadable = Boolean(body.retreadable);
  }

  if (body.max_retreads !== undefined) {
    updates.max_retreads = normalizeNonNegativeInteger(
      body.max_retreads,
      "max_retreads"
    );
  }

  if (body.is_active !== undefined) {
    updates.is_active = Boolean(body.is_active);
  } else if (mode === "create") {
    updates.is_active = true;
  }

  if (mode === "update" && Object.keys(updates).length === 0) {
    throw new Error("No valid part updates provided");
  }

  return updates;
}

async function resolvePartsAccess(
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
        { success: false, error: "Spares parts access required" },
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
        { success: false, error: "Spares parts access required" },
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
    const resolved = await resolvePartsAccess(
      req,
      searchParams.get("companyId"),
      "view"
    );
    if (resolved.error) return resolved.error;

    const { data: parts, error } = await supabaseAdmin
      .from("spare_catalog_parts")
      .select(
        "id, name, category, brand, model, part_number, default_unit, expected_life_km, expected_life_days, retreadable, max_retreads, is_active, notes, created_at, updated_at"
      )
      .eq("company_id", resolved.company.id)
      .order("name", { ascending: true });

    if (error) throw error;

    return noStoreJson({
      success: true,
      company: resolved.company,
      is_platform_owner: resolved.isPlatformOwner,
      roles: resolved.roles,
      capabilities: resolved.capabilities,
      parts: (parts || []).map(sanitizePart),
    });
  } catch (err: any) {
    console.error("Spares parts GET error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to load spare parts" },
      { status: badRequestStatus(err) }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const resolved = await resolvePartsAccess(
      req,
      body.companyId || null,
      "manage"
    );
    if (resolved.error) return resolved.error;

    const input = normalizePartInput(body, "create");
    const now = new Date().toISOString();

    const { data: part, error } = await supabaseAdmin
      .from("spare_catalog_parts")
      .insert({
        company_id: resolved.company.id,
        ...input,
        updated_at: now,
      })
      .select(
        "id, name, category, brand, model, part_number, default_unit, expected_life_km, expected_life_days, retreadable, max_retreads, is_active, notes, created_at, updated_at"
      )
      .single();

    if (error) throw error;

    return noStoreJson({
      success: true,
      part: sanitizePart(part),
    });
  } catch (err: any) {
    console.error("Spares parts POST error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to create spare part" },
      { status: badRequestStatus(err) }
    );
  }
}

