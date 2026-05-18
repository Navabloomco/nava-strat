import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { supabase } from "../../../lib/supabase";

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
const MANAGE_ROLES = new Set(["platform_owner", "owner", "admin"]);

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

function sanitizeTemplate(template: any) {
  return {
    id: template.id,
    name: template.name || null,
    client_name: template.client_name || null,
    from_location: template.from_location || null,
    to_location: template.to_location || null,
    expected_fuel_liters:
      template.expected_fuel_liters === null ||
      template.expected_fuel_liters === undefined
        ? null
        : Number(template.expected_fuel_liters),
    is_active: template.is_active !== false,
    created_at: template.created_at || null,
    updated_at: template.updated_at || null,
  };
}

function buildCapabilities(roles: string[], isPlatformOwner: boolean) {
  const normalizedRoles = new Set(roles.map((role) => role.toLowerCase()));
  const canManage =
    isPlatformOwner ||
    normalizedRoles.has("platform_owner") ||
    normalizedRoles.has("owner") ||
    normalizedRoles.has("admin");
  const canView =
    canManage ||
    normalizedRoles.has("ops") ||
    normalizedRoles.has("finance") ||
    normalizedRoles.has("management");

  return {
    can_view_journey_templates: canView,
    can_manage_journey_templates: canManage,
  };
}

function badRequestStatus(err: any) {
  const message = String(err?.message || "");
  return message.includes("required") ||
    message.includes("must") ||
    message.includes("Invalid")
    ? 400
    : 500;
}

function normalizeText(value: any) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function buildTemplateName(body: any, client: string, from: string, to: string) {
  const providedName = typeof body.name === "string" ? body.name.trim() : "";
  return providedName || `${client} · ${from} → ${to}`;
}

function normalizeTemplateInput(body: any, mode: "create" | "update") {
  const updates: Record<string, any> = {};

  const clientName =
    mode === "create" || body.client_name !== undefined
      ? normalizeText(body.client_name)
      : undefined;
  const fromLocation =
    mode === "create" || body.from_location !== undefined
      ? normalizeText(body.from_location)
      : undefined;
  const toLocation =
    mode === "create" || body.to_location !== undefined
      ? normalizeText(body.to_location)
      : undefined;

  if (mode === "create" || body.client_name !== undefined) {
    if (!clientName) throw new Error("Client name is required");
    updates.client_name = clientName;
  }

  if (mode === "create" || body.from_location !== undefined) {
    if (!fromLocation) throw new Error("From location is required");
    updates.from_location = fromLocation;
  }

  if (mode === "create" || body.to_location !== undefined) {
    if (!toLocation) throw new Error("To location is required");
    updates.to_location = toLocation;
  }

  if (mode === "create" || body.name !== undefined) {
    const name =
      mode === "create"
        ? buildTemplateName(body, clientName || "", fromLocation || "", toLocation || "")
        : String(body.name || "").trim();

    if (name) updates.name = name;
  }

  if (body.expected_fuel_liters !== undefined) {
    const rawFuel = body.expected_fuel_liters;
    if (rawFuel === null || rawFuel === "") {
      updates.expected_fuel_liters = null;
    } else {
      const fuel = Number(rawFuel);
      if (!Number.isFinite(fuel) || fuel <= 0) {
        throw new Error("Expected fuel must be a positive number");
      }
      updates.expected_fuel_liters = fuel;
    }
  }

  if (body.is_active !== undefined) {
    updates.is_active = Boolean(body.is_active);
  } else if (mode === "create") {
    updates.is_active = true;
  }

  if (mode === "update" && Object.keys(updates).length === 0) {
    throw new Error("No valid updates provided");
  }

  return updates;
}

async function resolveTemplateAccess(
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
        { success: false, error: "Saved route access required" },
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
        { success: false, error: "Saved route access required" },
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
    const resolved = await resolveTemplateAccess(
      req,
      searchParams.get("companyId"),
      "view"
    );
    if (resolved.error) return resolved.error;

    const { data: templates, error } = await supabaseAdmin
      .from("journey_templates")
      .select(
        "id, name, client_name, from_location, to_location, expected_fuel_liters, is_active, created_at, updated_at"
      )
      .eq("company_id", resolved.company.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return noStoreJson({
      success: true,
      company: resolved.company,
      is_platform_owner: resolved.isPlatformOwner,
      roles: resolved.roles,
      capabilities: resolved.capabilities,
      templates: (templates || []).map(sanitizeTemplate),
    });
  } catch (err: any) {
    console.error("Journey templates GET error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to load saved routes" },
      { status: badRequestStatus(err) }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const resolved = await resolveTemplateAccess(
      req,
      body.companyId || null,
      "manage"
    );
    if (resolved.error) return resolved.error;

    const input = normalizeTemplateInput(body, "create");
    const now = new Date().toISOString();

    const { data: template, error } = await supabaseAdmin
      .from("journey_templates")
      .insert({
        company_id: resolved.company.id,
        ...input,
        updated_at: now,
      })
      .select(
        "id, name, client_name, from_location, to_location, expected_fuel_liters, is_active, created_at, updated_at"
      )
      .single();

    if (error) throw error;

    return noStoreJson({
      success: true,
      template: sanitizeTemplate(template),
    });
  } catch (err: any) {
    console.error("Journey templates POST error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to create saved route" },
      { status: badRequestStatus(err) }
    );
  }
}
