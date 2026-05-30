import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const VIEW_ROLES = new Set([
  "owner",
  "admin",
  "platform_owner",
  "finance",
  "management",
  "ops",
]);
const MANAGE_ROLES = new Set(["owner", "admin", "platform_owner"]);

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

function sanitizeProvider(provider: any, includeFinance: boolean) {
  return {
    id: provider.id,
    name: provider.name,
    ...(includeFinance
      ? {
          default_price_per_liter:
            provider.current_price_per_liter === null ||
            provider.current_price_per_liter === undefined
              ? null
              : Number(provider.current_price_per_liter),
        }
      : {}),
    is_active: provider.is_active !== false,
    created_at: provider.created_at || null,
    updated_at: provider.updated_at || null,
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
    normalizedRoles.has("finance") ||
    normalizedRoles.has("management") ||
    normalizedRoles.has("ops");
  const canViewFinance =
    canManage || normalizedRoles.has("finance") || normalizedRoles.has("management");

  return {
    can_view_fuel_providers: canView,
    can_manage_fuel_providers: canManage,
    can_view_finance: canViewFinance,
  };
}

function rolesForSelectedCompany(
  memberships: any[],
  companyId: string,
  includePlatformOwner = false
) {
  const roles = (memberships || [])
    .filter((membership) => membership.company_id === companyId)
    .map((membership) => String(membership.role || "").toLowerCase())
    .filter(Boolean);

  if (
    includePlatformOwner &&
    (memberships || []).some(
      (membership) => String(membership.role || "").toLowerCase() === "platform_owner"
    )
  ) {
    roles.push("platform_owner");
  }

  return Array.from(new Set(roles));
}

function badRequestStatus(err: any) {
  const message = String(err?.message || "");
  return message.includes("required") ||
    message.includes("must") ||
    message.includes("Invalid")
    ? 400
    : 500;
}

function normalizeProviderInput(body: any, mode: "create" | "update") {
  const updates: Record<string, any> = {};

  if (mode === "create" || body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (!name) throw new Error("Name is required");
    updates.name = name;
  }

  if (body.default_price_per_liter !== undefined) {
    const rawPrice = body.default_price_per_liter;
    if (rawPrice === null || rawPrice === "") {
      updates.current_price_per_liter = null;
    } else {
      const price = Number(rawPrice);
      if (!Number.isFinite(price) || price <= 0) {
        throw new Error("Default price per liter must be a positive number");
      }
      updates.current_price_per_liter = price;
    }
  }

  if (body.is_active !== undefined) {
    updates.is_active = Boolean(body.is_active);
  } else if (mode === "create") {
    updates.is_active = true;
  }

  return updates;
}

async function resolveFuelProviderAccess(
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
  const isPlatformOwner = activeMemberships.some(
    (membership) => String(membership.role || "").toLowerCase() === "platform_owner"
  );
  const allowedRoles = mode === "manage" ? MANAGE_ROLES : VIEW_ROLES;
  const requestedCompanyIdValue = requestedCompanyId?.trim() || null;

  if (isPlatformOwner) {
    const companyQuery = supabaseAdmin.from("companies").select("id, name, slug");
    const { data: company, error: companyError } = requestedCompanyIdValue
      ? await companyQuery.eq("id", requestedCompanyIdValue).maybeSingle()
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

    const roles = rolesForSelectedCompany(activeMemberships, company.id, true);
    const capabilities = buildCapabilities(roles, true);

    return {
      company: company as ResolvedCompany,
      userId: user.id,
      roles,
      isPlatformOwner,
      capabilities,
    };
  }

  const membership = requestedCompanyIdValue
    ? activeMemberships.find(
        (item) =>
          item.company_id === requestedCompanyIdValue &&
          allowedRoles.has(String(item.role || "").toLowerCase())
      )
    : activeMemberships.find((item) =>
        allowedRoles.has(String(item.role || "").toLowerCase())
      );
  const companyId = membership?.company_id;

  if (!companyId) {
    return {
      error: noStoreJson(
        { success: false, error: "Fuel provider access required" },
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

  const roles = rolesForSelectedCompany(activeMemberships, company.id);
  const capabilities = buildCapabilities(roles, false);

  return {
    company: company as ResolvedCompany,
    userId: user.id,
    roles,
    isPlatformOwner,
    capabilities,
  };
}

async function selectFuelProviders(companyId: string) {
  const baseSelect =
    "id, name, current_price_per_liter, is_active, created_at";
  const withUpdatedAt = `${baseSelect}, updated_at`;

  const result = await supabaseAdmin
    .from("fuel_providers")
    .select(withUpdatedAt)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });

  if (!result.error) return result;

  const message = String(result.error.message || "");
  if (!message.includes("updated_at")) return result;

  return supabaseAdmin
    .from("fuel_providers")
    .select(baseSelect)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const resolved = await resolveFuelProviderAccess(
      req,
      searchParams.get("companyId"),
      "view"
    );
    if (resolved.error) return resolved.error;

    const { data: providers, error } = await selectFuelProviders(
      resolved.company.id
    );

    if (error) throw error;

    return noStoreJson({
      success: true,
      company: resolved.company,
      is_platform_owner: resolved.isPlatformOwner,
      roles: resolved.roles,
      capabilities: resolved.capabilities,
      fuel_providers: (providers || []).map((provider) =>
        sanitizeProvider(provider, Boolean(resolved.capabilities.can_view_finance))
      ),
    });
  } catch (err: any) {
    console.error("Fuel providers GET error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to load fuel providers" },
      { status: badRequestStatus(err) }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const resolved = await resolveFuelProviderAccess(
      req,
      body.companyId || null,
      "manage"
    );
    if (resolved.error) return resolved.error;

    const input = normalizeProviderInput(body, "create");

    const { data: provider, error } = await supabaseAdmin
      .from("fuel_providers")
      .insert({
        company_id: resolved.company.id,
        ...input,
      })
      .select("id, name, current_price_per_liter, is_active, created_at")
      .single();

    if (error) throw error;

    return noStoreJson({
      success: true,
      fuel_provider: sanitizeProvider(
        provider,
        Boolean(resolved.capabilities.can_view_finance)
      ),
    });
  } catch (err: any) {
    console.error("Fuel providers POST error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to create fuel provider" },
      { status: badRequestStatus(err) }
    );
  }
}
