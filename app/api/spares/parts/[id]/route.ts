import { NextResponse } from "next/server";
import { supabase } from "../../../../../lib/supabase";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

function badRequestStatus(err: any) {
  const message = String(err?.message || "");
  if (message.includes("not found")) return 404;
  return message.includes("required") ||
    message.includes("Invalid") ||
    message.includes("positive") ||
    message.includes("integer") ||
    message.includes("non-negative") ||
    message.includes("No valid")
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

function normalizePartUpdates(body: any) {
  const updates: Record<string, any> = {};

  if (body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (!name) throw new Error("name is required");
    updates.name = name;
  }

  if (body.category !== undefined) {
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

  if (body.retreadable !== undefined) {
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
  }

  if (Object.keys(updates).length === 0) {
    throw new Error("No valid part updates provided");
  }

  updates.updated_at = new Date().toISOString();
  return updates;
}

async function resolvePartsAccess(req: Request, requestedCompanyId?: string | null) {
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
    isPlatformOwner || roles.some((role) => MANAGE_ROLES.has(role));

  if (!hasAllowedRole) {
    return {
      error: noStoreJson(
        { success: false, error: "Spares parts management access required" },
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
        { success: false, error: "Spares parts management access required" },
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
    isPlatformOwner,
  };
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const resolved = await resolvePartsAccess(req, body.companyId || null);
    if (resolved.error) return resolved.error;

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("spare_catalog_parts")
      .select("id")
      .eq("company_id", resolved.company.id)
      .eq("id", params.id)
      .maybeSingle();

    if (existingError) throw existingError;
    if (!existing) {
      return noStoreJson(
        { success: false, error: "Spare part not found" },
        { status: 404 }
      );
    }

    const updates = normalizePartUpdates(body);

    const { data: part, error } = await supabaseAdmin
      .from("spare_catalog_parts")
      .update(updates)
      .eq("company_id", resolved.company.id)
      .eq("id", params.id)
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
    console.error("Spares part PATCH error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to update spare part" },
      { status: badRequestStatus(err) }
    );
  }
}

