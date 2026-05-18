import { NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const EDIT_ROLES = new Set(["owner", "admin", "platform_owner"]);

const BUSINESS_TYPES = new Set([
  "long_haul_transport",
  "passenger_transport",
  "courier_delivery",
  "field_service",
  "construction_equipment",
  "sales_fleet",
  "mixed_fleet",
  "other",
]);

const PRIMARY_ASSET_TYPES = new Set([
  "truck",
  "trailer",
  "bus",
  "van",
  "pickup",
  "car",
  "motorcycle",
  "equipment",
  "other",
]);

const BILLING_UNITS = new Set([
  "trip",
  "tonne",
  "passenger",
  "delivery",
  "hour",
  "day",
  "asset",
  "other",
]);

const companySelect =
  "id, name, slug, business_type, primary_asset_types, main_billing_unit, operating_regions, primary_use_case";

function noStoreJson(body: any, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      "Cache-Control": "no-store",
    },
  });
}

function normalizeOptionalChoice(
  value: any,
  allowed: Set<string>,
  fieldName: string
) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (!allowed.has(text)) {
    throw new Error(`Invalid ${fieldName}`);
  }
  return text;
}

function normalizeStringArray(value: any, allowed?: Set<string>, fieldName?: string) {
  const rawValues = Array.isArray(value)
    ? value
    : String(value || "")
        .split(",")
        .map((item) => item.trim());

  const normalized = Array.from(
    new Set(
      rawValues.map((item) => String(item || "").trim()).filter(Boolean)
    )
  ).slice(0, 20);

  if (allowed) {
    const invalid = normalized.find((item) => !allowed.has(item));
    if (invalid) {
      throw new Error(`Invalid ${fieldName || "value"}`);
    }
  }

  return normalized;
}

function normalizeShortText(value: any) {
  const text = String(value || "").trim();
  return text ? text.slice(0, 240) : null;
}

function safeCompany(company: any) {
  return {
    id: company.id,
    name: company.name,
    slug: company.slug,
  };
}

function operatingContext(company: any) {
  return {
    business_type: company.business_type || null,
    primary_asset_types: company.primary_asset_types || [],
    main_billing_unit: company.main_billing_unit || null,
    operating_regions: company.operating_regions || [],
    primary_use_case: company.primary_use_case || null,
  };
}

async function resolveCompany(req: Request, requestedCompanyId?: string | null) {
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
  const roles = activeMemberships.map((membership) =>
    String(membership.role || "").toLowerCase()
  );
  const isPlatformOwner = roles.includes("platform_owner");
  const canEdit = roles.some((role) => EDIT_ROLES.has(role));

  if (!canEdit) {
    return {
      error: noStoreJson(
        { success: false, error: "Company settings access required" },
        { status: 403 }
      ),
    };
  }

  if (isPlatformOwner) {
    const companyQuery = supabaseAdmin.from("companies").select(companySelect);
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

    return { company, user, isPlatformOwner, canEditOperatingContext: true };
  }

  const editableMembership = activeMemberships.find((membership) =>
    EDIT_ROLES.has(String(membership.role || "").toLowerCase())
  );
  const companyId = editableMembership?.company_id;

  if (!companyId) {
    return {
      error: noStoreJson(
        { success: false, error: "Company settings access required" },
        { status: 403 }
      ),
    };
  }

  const { data: company, error: companyError } = await supabaseAdmin
    .from("companies")
    .select(companySelect)
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

  return { company, user, isPlatformOwner, canEditOperatingContext: true };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const resolved = await resolveCompany(req, searchParams.get("companyId"));
    if (resolved.error) return resolved.error;

    return noStoreJson({
      success: true,
      company: safeCompany(resolved.company),
      operating_context: operatingContext(resolved.company),
      capabilities: {
        can_edit_operating_context: resolved.canEditOperatingContext,
      },
    });
  } catch (err: any) {
    console.error("Company settings GET error:", err);
    return noStoreJson(
      {
        success: false,
        error: err.message || "Failed to load company settings",
      },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { searchParams } = new URL(req.url);
    const resolved = await resolveCompany(
      req,
      body.companyId || searchParams.get("companyId")
    );
    if (resolved.error) return resolved.error;

    const updates = {
      business_type: normalizeOptionalChoice(
        body.business_type,
        BUSINESS_TYPES,
        "business_type"
      ),
      primary_asset_types: normalizeStringArray(
        body.primary_asset_types,
        PRIMARY_ASSET_TYPES,
        "primary_asset_types"
      ),
      main_billing_unit: normalizeOptionalChoice(
        body.main_billing_unit,
        BILLING_UNITS,
        "main_billing_unit"
      ),
      operating_regions: normalizeStringArray(body.operating_regions),
      primary_use_case: normalizeShortText(body.primary_use_case),
    };

    const { data: company, error } = await supabaseAdmin
      .from("companies")
      .update(updates)
      .eq("id", resolved.company.id)
      .select(companySelect)
      .single();

    if (error) throw error;

    return noStoreJson({
      success: true,
      company: safeCompany(company),
      operating_context: operatingContext(company),
      capabilities: {
        can_edit_operating_context: true,
      },
    });
  } catch (err: any) {
    console.error("Company settings PATCH error:", err);
    const message = err.message || "Failed to update company settings";
    const status = message.startsWith("Invalid ") ? 400 : 500;
    return noStoreJson(
      {
        success: false,
        error: message,
      },
      { status }
    );
  }
}
